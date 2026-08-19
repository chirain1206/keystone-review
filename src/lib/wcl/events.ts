import { envConfig, requireProductionEnv } from "@/lib/env";
import { gqlQuery, getAccessToken, WclGqlError } from "@/lib/wcl/adapter";
import { resolveAbilityNames } from "@/lib/wcl/ability-names";
import { mockPlayers } from "@/lib/wcl/players";

/**
 * WCL v2 GraphQL 事件查询（事件级数据，FR-1/FR-10）。
 *
 * 配额保护设计（对齐 TECH-DESIGN "WCL 只做轻量查询"）：
 *  - 只拉"所选玩家"的必要事件 + 必要的敌方光环（BOSS 易伤）事件，绝不拉全量；
 *  - 按事件用途拆分 5 个定向 dataType 查询（casts/interrupts/buffs/deaths/敌方 buffs），
 *    避免 dataType:All 拉入海量伤害/治疗事件（WCL 按返回事件计配额点）；
 *  - 每查询分页上限 MAX_EVENT_PAGES 页，每页 EVENTS_PER_PAGE 条，超限打 truncated 标记；
 *  - 拉取前检查 x-ratelimit-remaining，低于阈值跳过（返回配额不足标记，不抛错、不浪费点数）；
 *  - 单通道失败（429/网络）保留已拉部分 + truncated，不再整体抛错；
 *  - 同一 (code, fightId, playerId) 事件进程内缓存，重复 from-link/重试不重复消耗配额。
 *
 * 字段名已对照官方 v2 schema 核实（见完成回报的"字段核实结论"）：
 *  - events(fightIDs, sourceID, targetID, hostilityType, dataType, startTime, endTime, limit)
 *    返回 ReportEventPaginator { data, nextPageTimestamp }；
 *  - dataType 取 EventDataType 枚举（Casts/Interrupts/Buffs/Deaths/…），无 type 参数；
 *  - 事件与 fight 的时间戳均为"相对报告起点"毫秒，战斗内秒 = (timestamp - fight.startTime)/1000。
 *  - 实测：events.data 返回**数组**（非 JSON 字符串）；事件只含 abilityGameID/extraAbilityGameID，
 *    translate:true 也不补 ability.name，故名称需经 lib/wcl/ability-names 批量映射。
 */

export interface WclRawEvent {
  /** 相对报告起点的毫秒时间戳。 */
  timestamp: number;
  /** 事件类型："cast" | "begincast" | "interrupt" | "death" | "applybuff" | "removebuff" | "refreshbuff" | … */
  type: string;
  sourceID?: number;
  targetID?: number;
  source?: { name?: string; id?: number };
  target?: { name?: string; id?: number };
  ability?: { name?: string; guid?: number };
  /** WCL v2 事件只回传 abilityGameID（无名称），需另查 worldData 映射为 ability.name。 */
  abilityGameID?: number;
  /** 打断事件里被断的技能（WCL 用 extraAbility 表示）。 */
  extraAbility?: { name?: string; guid?: number };
  /** 打断事件里被断技能的能力 id（与 abilityGameID 同源，需映射为 extraAbility.name）。 */
  extraAbilityGameID?: number;
  amount?: number;
  fight?: number;
}

export interface WclEventsResult {
  events: WclRawEvent[];
  /** true = 任一查询达到分页上限或单通道失败，事件可能不完整（仍返回已拉部分）。 */
  truncated: boolean;
  /** true = 因配额不足跳过部分/全部事件拉取（降级标记，非错误）。 */
  quotaInsufficient?: boolean;
}

export const MAX_EVENT_PAGES = 5;
export const EVENTS_PER_PAGE = 500;
/** 剩余点数低于该阈值时跳过事件拉取，避免耗尽配额触发 429。 */
export const RATELIMIT_SKIP_THRESHOLD = 150;

/** 测试注入点：fetch 与凭证可覆写（缺省读 envConfig）。 */
export interface WclEventsDeps {
  fetchFn?: typeof fetch;
  clientId?: string;
  clientSecret?: string;
}

const EVENTS_QUERY = `
query ReportEvents(
  $code: String!
  $fightIDs: [Int]
  $sourceID: Int
  $targetID: Int
  $hostilityType: HostilityType
  $dataType: EventDataType
  $startTime: Float
  $endTime: Float
  $limit: Int
) {
  reportData {
    report(code: $code) {
      events(
        fightIDs: $fightIDs
        sourceID: $sourceID
        targetID: $targetID
        hostilityType: $hostilityType
        dataType: $dataType
        startTime: $startTime
        endTime: $endTime
        limit: $limit
        translate: false
      ) {
        data
        nextPageTimestamp
      }
    }
  }
}`;

interface EventsPage {
  data?: unknown;
  nextPageTimestamp?: number | null;
}

interface ChannelVars {
  code: string;
  fightIDs: number[];
  dataType: string;
  sourceID?: number;
  targetID?: number;
  hostilityType?: "Friendlies" | "Enemies";
  startTime: number;
  endTime: number;
}

/** 单页结果（供 collectPaginated 消费）。 */
export interface PageFetchResult {
  events: WclRawEvent[];
  nextPageTimestamp: number | null;
}

/**
 * 解析 events.data：兼容数组与 JSON 字符串两种形态。
 * 实测 WCL v2 返回数组；保留字符串兼容以防 schema 演进/不同域差异。
 */
function parseEvents(raw: unknown): WclRawEvent[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw as WclRawEvent[];
  if (typeof raw === "string") {
    try {
      const arr: unknown = JSON.parse(raw);
      if (Array.isArray(arr)) return arr as WclRawEvent[];
    } catch {
      // 非法 JSON 视为无事件
    }
  }
  return [];
}

/**
 * 通用分页收集：从 initialStartTime 起逐页拉取，最多 MAX_EVENT_PAGES 页；
 * 达到页数上限仍有下一页、或单页拉取失败时打 truncated（仍返回已拉部分）。纯逻辑，便于单测。
 * 单页失败可通过 isRateLimit 判定是否为配额错误，命中则额外打 quotaInsufficient。
 */
export async function collectPaginated(
  initialStartTime: number | undefined,
  fetchPage: (startTime: number | undefined) => Promise<PageFetchResult>,
  opts: { isRateLimit?: (err: unknown) => boolean } = {},
): Promise<WclEventsResult> {
  const events: WclRawEvent[] = [];
  let startTime = initialStartTime;
  let truncated = false;
  let quotaInsufficient = false;

  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    let r: PageFetchResult;
    try {
      r = await fetchPage(startTime);
    } catch (err) {
      // 单页失败（429/网络）：保留已拉部分并打截断标记，不再整体抛错
      truncated = true;
      if (opts.isRateLimit?.(err)) quotaInsufficient = true;
      break;
    }
    events.push(...r.events);
    if (r.nextPageTimestamp == null) break;
    if (page === MAX_EVENT_PAGES - 1) {
      truncated = true;
      break;
    }
    startTime = r.nextPageTimestamp;
  }
  return { events, truncated, quotaInsufficient };
}

interface ChannelResult extends WclEventsResult {
  remaining: number | null;
}

/** 单通道分页拉取；达到页数上限或单页失败时打 truncated。 */
async function fetchChannel(
  region: "www" | "cn",
  token: string,
  variables: ChannelVars,
  fetchFn?: typeof fetch,
): Promise<ChannelResult> {
  let remaining: number | null = null;
  const res = await collectPaginated(variables.startTime, async (startTime) => {
    const { data, ratelimitRemaining } = await gqlQuery<{
      reportData?: { report?: { events?: EventsPage | null } | null };
    }>(region, token, EVENTS_QUERY, {
      ...variables,
      startTime,
      limit: EVENTS_PER_PAGE,
    }, fetchFn);
    remaining = ratelimitRemaining;
    const pag = data.reportData?.report?.events;
    return { events: parseEvents(pag?.data), nextPageTimestamp: pag?.nextPageTimestamp ?? null };
  }, {
    isRateLimit: (err) => err instanceof WclGqlError && err.status === 429,
  });
  return { ...res, remaining };
}

export interface FightEventsParams {
  code: string;
  region: "www" | "cn";
  fightId: number;
  playerId: number;
  /** 战斗开始（相对报告起点毫秒），用于时间戳对齐。 */
  fightStartMs: number;
  /** 战斗结束（相对报告起点毫秒）。 */
  fightEndMs: number;
  /** 显式 mock 标志（无 WCL 密钥时走合成数据）。 */
  isMock?: boolean;
}

/** 把名称映射回填到事件的 ability/extraAbility。 */
function applyAbilityNames(events: WclRawEvent[], names: Map<number, string>): void {
  for (const ev of events) {
    if (ev.abilityGameID != null) {
      const name = names.get(ev.abilityGameID);
      ev.ability = { guid: ev.abilityGameID, name: name ?? ev.ability?.name };
    }
    if (ev.extraAbilityGameID != null) {
      const name = names.get(ev.extraAbilityGameID);
      ev.extraAbility = { guid: ev.extraAbilityGameID, name: name ?? ev.extraAbility?.name };
    }
  }
}

/** 真实 API：5 个定向查询（所选玩家 casts/interrupts/buffs/deaths + 敌方 buffs）。 */
async function fetchRealEvents(
  params: FightEventsParams,
  deps: WclEventsDeps,
): Promise<WclEventsResult> {
  const token = await getAccessToken(params.region, deps);
  const base = {
    code: params.code,
    fightIDs: [params.fightId],
    startTime: params.fightStartMs,
    endTime: params.fightEndMs,
  };
  const channels: ChannelVars[] = [
    { ...base, dataType: "Casts", sourceID: params.playerId },
    { ...base, dataType: "Interrupts", sourceID: params.playerId },
    { ...base, dataType: "Buffs", targetID: params.playerId },
    { ...base, dataType: "Deaths", targetID: params.playerId },
    { ...base, dataType: "Buffs", hostilityType: "Enemies" },
  ];

  const events: WclRawEvent[] = [];
  let truncated = false;
  let quotaInsufficient = false;
  let remaining: number | null = null;

  for (const ch of channels) {
    // 拉取前检查剩余点数：低于阈值跳过，避免耗尽配额（不抛错、不浪费点数）
    if (remaining !== null && remaining < RATELIMIT_SKIP_THRESHOLD) {
      quotaInsufficient = true;
      truncated = true;
      break;
    }
    let r: ChannelResult;
    try {
      r = await fetchChannel(params.region, token, ch, deps.fetchFn);
    } catch (err) {
      // 通道级意外错误（页面错误已被 collectPaginated 吞掉，这里兜底）：保留部分并停止
      truncated = true;
      if (err instanceof WclGqlError && err.status === 429) quotaInsufficient = true;
      break;
    }
    remaining = r.remaining;
    events.push(...r.events);
    truncated = truncated || r.truncated;
    if (r.quotaInsufficient) {
      // 429 是全局配额错误，后续通道同样会失败，停止避免无谓请求
      quotaInsufficient = true;
      break;
    }
  }

  // 能力名称映射（translate:false 只回传 abilityGameID）——best-effort，失败不阻塞
  if (events.length > 0) {
    const ids = new Set<number>();
    for (const ev of events) {
      if (ev.abilityGameID != null && ev.abilityGameID > 0) ids.add(ev.abilityGameID);
      if (ev.extraAbilityGameID != null && ev.extraAbilityGameID > 0) ids.add(ev.extraAbilityGameID);
    }
    try {
      const names = await resolveAbilityNames(params.region, token, ids, deps);
      applyAbilityNames(events, names);
    } catch {
      // 名称解析失败：事件仍保留 abilityGameID，to-processed 侧尽力处理
    }
  }

  return { events, truncated, quotaInsufficient };
}

// ---------- mock ----------

/** mock：为所选玩家合成必要事件（与 mock 元数据同源，离线自测）。 */
function mockEvents(playerId: number, fightStartMs: number): WclRawEvent[] {
  const at = (t: number) => Math.round(fightStartMs + t * 1000);
  const pname = mockPlayers().find((p) => p.id === playerId)?.name ?? `Player#${playerId}`;
  return [
    { timestamp: at(10), type: "cast", sourceID: playerId, targetID: 99, ability: { name: "Fireball", guid: 133 } },
    { timestamp: at(100), type: "cast", sourceID: playerId, targetID: 99, ability: { name: "Combustion", guid: 190319 } },
    { timestamp: at(336), type: "cast", sourceID: playerId, targetID: playerId, ability: { name: "Potion of the Frozen Focus", guid: 371033 } },
    { timestamp: at(100), type: "applybuff", sourceID: playerId, targetID: playerId, ability: { name: "Combustion", guid: 190319 } },
    { timestamp: at(112), type: "removebuff", sourceID: playerId, targetID: playerId, ability: { name: "Combustion", guid: 190319 } },
    { timestamp: at(336), type: "applybuff", sourceID: playerId, targetID: playerId, ability: { name: "Potion of the Frozen Focus", guid: 371033 } },
    { timestamp: at(200), type: "interrupt", sourceID: playerId, targetID: 88, ability: { name: "Counterspell", guid: 2139 }, extraAbility: { name: "Bewildering Pollen", guid: 205749 } },
    { timestamp: at(500), type: "death", sourceID: 88, targetID: playerId, ability: { name: "Bewildering Pollen", guid: 205749 }, source: { name: "Mistcaller", id: 88 }, target: { name: pname, id: playerId } },
    { timestamp: at(600), type: "applybuff", sourceID: playerId, targetID: 999, ability: { name: "Vulnerable", guid: 1 }, target: { name: "Mistcaller", id: 999 } },
    { timestamp: at(615), type: "removebuff", sourceID: playerId, targetID: 999, ability: { name: "Vulnerable", guid: 1 }, target: { name: "Mistcaller", id: 999 } },
  ];
}

// ---------- 事件缓存（配额保护） ----------
// key = `${region}|${code}|${fightId}|${playerId}`；同一场战斗的角色事件进程内缓存，
// 重复 from-link / 重试命中缓存后不消耗 WCL 配额。region 一并纳入 key：WCL 报告 code
// 全局唯一、cn 与 www 共享数据，但保守起见按 region 隔离。
const EVENT_CACHE = new Map<string, { result: WclEventsResult; at: number }>();
/** 10 分钟：同一场战斗日志短期内不变，过期后允许重新拉取。 */
const EVENT_CACHE_TTL_MS = 10 * 60 * 1000;
/** 进程内最多缓存 200 场，超限删最旧（简单 LRU），防内存膨胀。 */
const EVENT_CACHE_MAX = 200;

function eventCacheKey(params: FightEventsParams): string {
  return `${params.region}|${params.code}|${params.fightId}|${params.playerId}`;
}

function readEventCache(key: string): WclEventsResult | null {
  const hit = EVENT_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= EVENT_CACHE_TTL_MS) {
    EVENT_CACHE.delete(key);
    return null;
  }
  return hit.result;
}

function writeEventCache(key: string, result: WclEventsResult): void {
  if (EVENT_CACHE.size >= EVENT_CACHE_MAX && !EVENT_CACHE.has(key)) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of EVENT_CACHE) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey !== null) EVENT_CACHE.delete(oldestKey);
  }
  EVENT_CACHE.set(key, { result, at: Date.now() });
}

/** 测试用：清空进程内事件缓存。 */
export function clearEventCache(): void {
  EVENT_CACHE.clear();
}

// ---------- 统一入口 ----------

/**
 * 拉取所选玩家在某场战斗的必要事件（施放/爆发/CD、打断、死亡、敌方易伤光环）。
 * 真实路径命中缓存直接返回；失败不再整体抛错——单通道失败保留部分数据，
 * 配额不足跳过并带标记，由调用方降级处理。
 */
export async function getFightEvents(
  params: FightEventsParams,
  deps: WclEventsDeps = {},
): Promise<WclEventsResult> {
  const useReal = Boolean(
    (deps.clientId ?? envConfig.wclClientId) && (deps.clientSecret ?? envConfig.wclClientSecret),
  );
  if (!useReal || params.isMock) {
    return { events: mockEvents(params.playerId, params.fightStartMs), truncated: false };
  }
  requireProductionEnv("WCL_CLIENT_ID", "WCL_CLIENT_SECRET");

  const key = eventCacheKey(params);
  const cached = readEventCache(key);
  if (cached) return cached;

  const result = await fetchRealEvents(params, deps);
  writeEventCache(key, result);
  return result;
}
