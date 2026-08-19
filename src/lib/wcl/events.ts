import { envConfig, requireProductionEnv } from "@/lib/env";
import { gqlQuery, getAccessToken } from "@/lib/wcl/adapter";
import { mockPlayers } from "@/lib/wcl/players";

/**
 * WCL v2 GraphQL 事件查询（事件级数据，FR-1/FR-10）。
 *
 * 配额保护设计（对齐 TECH-DESIGN "WCL 只做轻量查询"）：
 *  - 只拉"所选玩家"的必要事件 + 必要的敌方光环（BOSS 易伤）事件，绝不拉全量；
 *  - 按事件用途拆分 5 个定向 dataType 查询（casts/interrupts/buffs/deaths/敌方 buffs），
 *    避免 dataType:All 拉入海量伤害/治疗事件（WCL 按返回事件计配额点）；
 *  - 每查询分页上限 MAX_EVENT_PAGES 页，超限打 truncated 标记（仍返回已拉部分）。
 *
 * 字段名已对照官方 v2 schema 核实（见完成回报的"字段核实结论"）：
 *  - events(fightIDs, sourceID, targetID, hostilityType, dataType, startTime, endTime, limit)
 *    返回 ReportEventPaginator { data: JSON 字符串, nextPageTimestamp }；
 *  - dataType 取 EventDataType 枚举（Casts/Interrupts/Buffs/Deaths/…），无 type 参数；
 *  - useAbilityIDs/useActorIDs 是"是否附带能力/actor 明细"的布尔开关，不是 id 列表过滤；
 *  - 事件与 fight 的时间戳均为"相对报告起点"毫秒，战斗内秒 = (timestamp - fight.startTime)/1000。
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
  /** 打断事件里被断的技能（WCL 用 extraAbility 表示）。 */
  extraAbility?: { name?: string; guid?: number };
  amount?: number;
  fight?: number;
}

export interface WclEventsResult {
  events: WclRawEvent[];
  /** true = 任一查询达到分页上限，事件可能不完整。 */
  truncated: boolean;
}

export const MAX_EVENT_PAGES = 10;
export const EVENTS_PER_PAGE = 1000;

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
  data?: string | null;
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
 * 通用分页收集：从 initialStartTime 起逐页拉取，最多 MAX_EVENT_PAGES 页；
 * 达到页数上限仍有下一页时打 truncated（仍返回已拉部分）。纯逻辑，便于单测。
 */
export async function collectPaginated(
  initialStartTime: number | undefined,
  fetchPage: (startTime: number | undefined) => Promise<PageFetchResult>,
): Promise<WclEventsResult> {
  const events: WclRawEvent[] = [];
  let startTime = initialStartTime;
  let truncated = false;

  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const r = await fetchPage(startTime);
    events.push(...r.events);
    if (r.nextPageTimestamp == null) break;
    if (page === MAX_EVENT_PAGES - 1) {
      truncated = true;
      break;
    }
    startTime = r.nextPageTimestamp;
  }
  return { events, truncated };
}

/** 单通道分页拉取；达到页数上限时打 truncated。 */
async function fetchChannel(
  region: "www" | "cn",
  token: string,
  variables: ChannelVars,
): Promise<WclEventsResult> {
  return collectPaginated(variables.startTime, async (startTime) => {
    const data = await gqlQuery<{
      reportData?: { report?: { events?: EventsPage | null } | null };
    }>(region, token, EVENTS_QUERY, {
      ...variables,
      startTime,
      limit: EVENTS_PER_PAGE,
    });
    const pag = data.reportData?.report?.events;
    const events: WclRawEvent[] = [];
    if (pag?.data) {
      try {
        const arr: unknown = JSON.parse(pag.data);
        if (Array.isArray(arr)) events.push(...(arr as WclRawEvent[]));
      } catch {
        // 非数组 data 视为无事件，继续分页
      }
    }
    return { events, nextPageTimestamp: pag?.nextPageTimestamp ?? null };
  });
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
  for (const ch of channels) {
    const r = await fetchChannel(params.region, token, ch);
    events.push(...r.events);
    truncated = truncated || r.truncated;
  }
  return { events, truncated };
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

// ---------- 统一入口 ----------

/**
 * 拉取所选玩家在某场战斗的必要事件（施放/爆发/CD、打断、死亡、敌方易伤光环）。
 * 失败向上抛错，由调用方降级为"仅元数据 + 数据不足"。
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
  return fetchRealEvents(params, deps);
}
