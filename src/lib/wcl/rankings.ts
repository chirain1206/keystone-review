import { envConfig, requireProductionEnv } from "@/lib/env";
import { gqlQuery, getAccessToken, WclGqlError } from "@/lib/wcl/adapter";
import { buildPlayers, type WclPlayer } from "@/lib/wcl/players";
import { resolveNpcNames } from "@/lib/wcl/npc-names";
import { resolveDungeonEncounter } from "@/lib/wcl/dungeon-zones";
import { dungeonPullsToFingerprint, type DungeonPull } from "@/lib/route/dungeon-pulls";
import { buildCompProfile, type CompProfile } from "@/lib/route/comp-profile";
import { compareReference, type ReferenceProfile } from "@/lib/route/recommend";
import type { RouteFingerprint } from "@/lib/route/fingerprint";

/**
 * WCL 自动对比推荐（FR-3 对比 + FR-12 落地 + 产品补充："Key % 优先，相似度其次"）。
 *
 * 候选来源（排行榜）+ 该专精玩家表现（Key % / Parse %）：
 *  1) 候选搜索：worldData.encounter(id).characterRankings（className + specName 必填、
 *     metric=dps（可配 RANKING_METRIC）、bracket=层数-1、leaderboard=LogsOnly、page:1）——
 *     按该专精玩家 DPS 从高到低返回候选报告（code + fightID + amount）；
 *  2) 候选详情：fights（层数/成功/时长/阵容 + dungeonPulls 路线）+ masterData.actors +
 *     rankings(fightIDs, playerMetric=dps) → 该专精玩家的 bracketPercent(Key %) / rankPercent(Parse %)；
 *  3) 排序：主排序 = Key % 降序（缺失时 DPS 兜底）；次排序 = 路线相似度；再次 = 阵容相似度。
 *
 * 字段名已真实探测核实（live WCL v2，2026-08）：
 *  - characterRankings 需 className + specName 同传；返回 { page, hasMorePages, count, rankings: [...] }；
 *  - characterRankings 条目：report.code / report.fightID / hardModeLevel(=层数) / bracketData / amount(=DPS) /
 *    duration(ms) / score / medal；**无 Key %/Parse %**；
 *  - Key %（同层数同职业分位）= reportData.report.rankings(fightIDs, playerMetric:dps).data[].roles.{role}
 *    .characters[].bracketPercent；Parse % = 同处 rankPercent；
 *  - **dungeonPulls 挂在 ReportFight（fights[]）上，不是 Report**（旧实现误放 Report 导致 GraphQL 报错
 *    "Cannot query field dungeonPulls on type Report"，候选详情全失败 → 无推荐）；
 *  - bracket = 层数 - 1（bracket:9 → +10）。
 */

export type WclRegion = "www" | "cn";

/** 候选搜索上限（配额保护）。 */
export const RANKING_CANDIDATE_LIMIT = 10;
/** 候选详情并行度上限。 */
export const RANKING_PARALLELISM = 3;
/** 候选搜索缓存 TTL（1 小时）。 */
const RANKING_CACHE_TTL_MS = 60 * 60 * 1000;
/** 进程内候选搜索缓存上限（简单 LRU）。 */
const RANKING_CACHE_MAX = 200;

/** 层数搜索半径（RANGE_LEVELS 环境变量，默认 1：搜索 [level-1, level+1]）。 */
export function rangeLevels(): number {
  const raw = process.env.RANGE_LEVELS;
  if (raw === undefined || raw === "") return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

/** 排行指标（RANKING_METRIC 环境变量，默认 "dps"）。 */
export function rankingMetric(): string {
  const raw = (process.env.RANKING_METRIC ?? "").trim().toLowerCase();
  return raw || "dps";
}

/** 读非负整数环境变量；非法/缺失回退默认值。 */
function envNonNegativeInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * 候选时效性：新候选窗口（天，RECENCY_DAYS 环境变量，默认 14）。
 *
 * 语义说明：排行榜查询按"赛季 zone 的 encounter"检索，已天然限定在当前赛季；
 * RECENCY_DAYS / MAX_AGE_DAYS 是对**赛季内**热修 / 职业改动窗口的额外保护——
 * 更早打出的 log 可能依赖 bug 或改动前的数值，不宜直接作为对比基准。
 * 该天数内的候选按原三层排序（Key % 降序 → 路线相似度 → 阵容相似度）。
 */
export function recencyDays(): number {
  return envNonNegativeInt("RECENCY_DAYS", 14);
}

/**
 * 候选最大年龄（天，MAX_AGE_DAYS 环境变量，默认 30）：超过该天数的候选直接过滤。
 * 与 RECENCY_DAYS 之间（14–30 天）的候选保留但排在新候选之后，并标注"较早（注意职业改动）"。
 */
export function maxAgeDays(): number {
  return envNonNegativeInt("MAX_AGE_DAYS", 30);
}

export interface ReferenceRecommendation {
  code: string;
  /** 该 log 的场次 id（用于 WCL 链接 #fight=N 直达）。 */
  fightId: number | null;
  dungeon: string;
  level: number | null;
  success: boolean;
  durationSec: number;
  compSimilarity: number | null;
  routeSimilarity: number | null;
  /** 综合分（comp + route 均值；无任何可用维度为 null）。 */
  combined: number | null;
  /** Key %（同副本同层数同职业对比分位，0–100）；拿不到时为 null。 */
  keyPercent: number | null;
  /** Parse %（全历史解析分位，0–100）；拿不到时为 null。 */
  parsePercent: number | null;
  /** 该专精玩家 DPS（Key % 缺失时的兜底排序指标）。 */
  amount: number | null;
  /** M+ score。 */
  score: number | null;
  /** 奖牌：gold | silver | bronze | none。 */
  medal: string | null;
  /** 排行指标名（如 "dps"）。 */
  metricName: string | null;
  /** 候选报告 WCL 链接（带 #fight=N 直达该场）。 */
  url: string;
  /** 战斗开始的绝对时间（epoch 毫秒）；拿不到时为 null（前端显示日期未知，不参与时效过滤）。 */
  fightStartTimeMs: number | null;
  /** true = 较早候选（RECENCY_DAYS 与 MAX_AGE_DAYS 之间），前端标注"较早（注意职业改动）"。 */
  stale: boolean;
}

export interface ReferenceSearchResult {
  ok: boolean;
  candidates: ReferenceRecommendation[];
  /** 无候选/失败时的降级说明（前端据此静默回退到"手动粘贴对比链接"）。 */
  degradedReason?: string;
}

export interface RecommendReferencesInput {
  dungeon: string;
  level: number;
  /** 所选专精（characterRankings 过滤 + 候选队伍含该专精 + Key % 提取）。 */
  spec: string;
  /** 所选职业（characterRankings 需 className + specName 同时传）。 */
  playerClass?: string | null;
  region: WclRegion;
  /** 用户自己的路线指纹（来自用户报告 dungeonPulls；文件上传则有精确战术波）。 */
  userRoute?: RouteFingerprint | null;
  /** 用户自己的阵容画像。 */
  userComp?: CompProfile | null;
  /** 显式 mock 标志（无 WCL 密钥时走合成数据）。 */
  isMock?: boolean;
}

export interface RankingsDeps {
  fetchFn?: typeof fetch;
  clientId?: string;
  clientSecret?: string;
}

// ---------- 纯函数（可单测） ----------

interface RankingEntry {
  code: string;
  fightId: number | null;
  level: number | null;
  durationSec: number;
  /** 该专精玩家 DPS（metric=dps）。 */
  amount: number | null;
  /** M+ score。 */
  score: number | null;
  /** gold | silver | bronze | none。 */
  medal: string | null;
  /** 排行指标名（如 "dps"）。 */
  metricName: string | null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function extractCode(raw: Record<string, unknown>): string | null {
  for (const k of ["reportID", "reportId", "report_id", "code", "reportCode"]) {
    const v = asString(raw[k]);
    if (v) return v;
  }
  const report = raw["report"];
  if (report && typeof report === "object") {
    const code = asString((report as Record<string, unknown>)["code"]);
    if (code) return code;
  }
  return null;
}

function extractFightId(raw: Record<string, unknown>): number | null {
  for (const k of ["fightID", "fightId", "fight_id", "reportFightID", "reportFightId"]) {
    const v = asNumber(raw[k]);
    if (v !== null) return v;
  }
  const report = raw["report"];
  if (report && typeof report === "object") {
    for (const k of ["fightID", "fightId", "fight_id"]) {
      const v = asNumber((report as Record<string, unknown>)[k]);
      if (v !== null) return v;
    }
  }
  return null;
}

function extractLevel(raw: Record<string, unknown>): number | null {
  for (const k of ["hardModeLevel", "bracketData", "keystoneLevel", "keyLevel", "level"]) {
    const v = asNumber(raw[k]);
    if (v !== null) return v;
  }
  return null;
}

function extractDurationSec(raw: Record<string, unknown>): number {
  for (const k of ["duration", "keystoneTime", "fightTime", "durationSec"]) {
    const v = asNumber(raw[k]);
    if (v !== null && v > 0) return v >= 1000 ? Math.round(v / 1000) : Math.round(v);
  }
  return 0;
}

function extractAmount(raw: Record<string, unknown>): number | null {
  for (const k of ["amount", "total", "dps", "scoreValue", "value"]) {
    const v = asNumber(raw[k]);
    if (v !== null && v >= 0) return v;
  }
  return null;
}

function extractScore(raw: Record<string, unknown>): number | null {
  const v = asNumber(raw["score"]);
  return v !== null && v >= 0 ? v : null;
}

function extractMedal(raw: Record<string, unknown>): string | null {
  return asString(raw["medal"]);
}

/**
 * 解析 characterRankings 返回（兼容 { rankings: [...] } 包裹、{ error }、裸数组三态）。
 */
export function parseRankingEntries(raw: unknown): RankingEntry[] {
  if (!raw || typeof raw !== "object") return [];
  if (Array.isArray(raw)) {
    return raw.map(parseEntry).filter((e): e is RankingEntry => e !== null);
  }
  const obj = raw as Record<string, unknown>;
  if (obj["error"] !== undefined) return [];
  const rankings = obj["rankings"];
  if (Array.isArray(rankings)) {
    return rankings.map(parseEntry).filter((e): e is RankingEntry => e !== null);
  }
  return [];
}

function parseEntry(item: unknown): RankingEntry | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const code = extractCode(rec);
  if (!code) return null;
  return {
    code,
    fightId: extractFightId(rec),
    level: extractLevel(rec),
    durationSec: extractDurationSec(rec),
    amount: extractAmount(rec),
    score: extractScore(rec),
    medal: extractMedal(rec),
    metricName: null,
  };
}

/**
 * 从 reportData.report.rankings(...) 返回中提取该专精玩家的 Key %（bracketPercent）与
 * Parse %（rankPercent）。
 * 结构：{ data: [{ roles: { tanks/healers/dps: { characters: [{ spec, bracketPercent, rankPercent }] } } }] }。
 * bracketPercent/rankPercent 为 0 视为"未计算"（返回 null，交由 DPS 兜底）。
 */
export function extractSpecPercents(
  rankingsRaw: unknown,
  spec: string,
): { keyPercent: number | null; parsePercent: number | null } {
  const target = normalizeSpec(spec);
  if (!target || target === "unknown") return { keyPercent: null, parsePercent: null };
  const obj = rankingsRaw as Record<string, unknown> | null | undefined;
  const data = obj?.["data"];
  if (!Array.isArray(data)) return { keyPercent: null, parsePercent: null };
  for (const entry of data) {
    const roles = (entry as Record<string, unknown>)?.["roles"] as Record<string, unknown> | undefined;
    if (!roles) continue;
    for (const roleName of ["tanks", "healers", "dps"]) {
      const characters = (roles[roleName] as Record<string, unknown> | undefined)?.["characters"];
      if (!Array.isArray(characters)) continue;
      for (const c of characters) {
        if (!c || typeof c !== "object") continue;
        const rec = c as Record<string, unknown>;
        if (normalizeSpec(asString(rec["spec"]) ?? "") !== target) continue;
        const kp = asNumber(rec["bracketPercent"]);
        const pp = asNumber(rec["rankPercent"]);
        return {
          keyPercent: kp !== null && kp > 0 ? kp : null,
          parsePercent: pp !== null && pp > 0 ? pp : null,
        };
      }
    }
  }
  return { keyPercent: null, parsePercent: null };
}

/** 层数范围过滤：[level - range, level + range]。 */
export function filterByLevelRange(
  entries: RankingEntry[],
  level: number,
  range: number,
): RankingEntry[] {
  const lo = level - range;
  const hi = level + range;
  return entries.filter((e) => {
    if (e.level === null) return true;
    return e.level >= lo && e.level <= hi;
  });
}

/** 按 report code 去重（保留首个）。 */
export function dedupeByCode(entries: RankingEntry[]): RankingEntry[] {
  const seen = new Set<string>();
  const out: RankingEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.code)) continue;
    seen.add(e.code);
    out.push(e);
  }
  return out;
}

/** 取前 N（配额保护）。 */
export function limitEntries(entries: RankingEntry[], n: number): RankingEntry[] {
  return entries.slice(0, n);
}

/** 该专精玩家 DPS 降序排序（无指标的排最后）。 */
export function sortByAmountDesc(entries: RankingEntry[]): RankingEntry[] {
  return [...entries].sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
}

/** 专精名归一化（大小写/空格/连字符不敏感）。 */
export function normalizeSpec(spec: string): string {
  return spec.trim().toLowerCase().replace(/[\s\-_']/g, "");
}

/** WCL slug（className/specName 用）：去空格/连字符/下划线/撇号。 */
export function wclSlug(name: string): string {
  return name.trim().replace(/[\s\-_']/g, "");
}

/** 候选队伍专精过滤：候选阵容（friendlySpecs）含指定专精才保留。 */
export function specMatchesTeam(specs: readonly (string | null | undefined)[], spec: string): boolean {
  const target = normalizeSpec(spec);
  if (!target || target === "unknown") return true;
  return specs.some((s) => s != null && normalizeSpec(s) === target);
}

/** 最终推荐排序的候选形状（Key % + DPS + 路线 + 阵容）。 */
export interface RankableCandidate {
  keyPercent: number | null;
  amount: number | null;
  routeSimilarity: number | null;
  compSimilarity: number | null;
}

/**
 * "Key % 优先，相似度其次"排序：
 *  主排序 = Key % 降序（无 Key % 排最后）；Key % 缺失/相同时按 DPS 降序兜底；
 *  次排序 = 路线相似度降序；再次 = 阵容相似度降序。
 */
export function rankRecommendations<T extends RankableCandidate>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const ka = a.keyPercent ?? -1;
    const kb = b.keyPercent ?? -1;
    if (ka !== kb) return kb - ka;
    const aa = a.amount ?? -1;
    const ab = b.amount ?? -1;
    if (aa !== ab) return ab - aa;
    const ra = a.routeSimilarity ?? -1;
    const rb = b.routeSimilarity ?? -1;
    if (ra !== rb) return rb - ra;
    return (b.compSimilarity ?? -1) - (a.compSimilarity ?? -1);
  });
}

// ---------- 候选时效性（过滤 / 降权 / 标注，纯函数） ----------

/** 候选需携带绝对战斗时间（epoch 毫秒，null 表示未知）。 */
export interface RecencyInput {
  fightStartTimeMs: number | null;
}

/** 时效分层结果。 */
export interface RecencyRanked<T> {
  item: T;
  /** fresh = 新候选（RECENCY_DAYS 内或时间未知）；stale = 较早候选（14–30 天）。 */
  recency: "fresh" | "stale";
}

/** 距今年龄（天）；时间未知 / 非法 / 未来 → null。 */
export function ageInDays(fightStartTimeMs: number | null, nowMs: number): number | null {
  if (fightStartTimeMs === null || !Number.isFinite(fightStartTimeMs) || fightStartTimeMs <= 0) {
    return null;
  }
  const age = (nowMs - fightStartTimeMs) / (24 * 60 * 60 * 1000);
  return age < 0 ? null : age;
}

/**
 * 时效过滤与降权（在"Key % 优先，相似度其次"排序之后调用）：
 *  - age > maxAgeDays（超过 MAX_AGE_DAYS）→ 过滤掉；
 *  - recencyDays < age ≤ maxAgeDays → 保留但降权（排在新候选之后）并标注 stale；
 *  - age ≤ recencyDays（含时间未知 null）→ 视为新候选，保持原相对顺序。
 * 返回 [新候选…, 较早候选…]（各自内部仍保持传入顺序，即原三层排序）。
 */
export function rankByRecency<T extends RecencyInput>(
  ranked: readonly T[],
  opts: { nowMs: number; recencyDays: number; maxAgeDays: number },
): RecencyRanked<T>[] {
  const fresh: RecencyRanked<T>[] = [];
  const stale: RecencyRanked<T>[] = [];
  for (const item of ranked) {
    const age = ageInDays(item.fightStartTimeMs, opts.nowMs);
    if (age !== null && age > opts.maxAgeDays) continue;
    const isStale = age !== null && age > opts.recencyDays;
    (isStale ? stale : fresh).push({ item, recency: isStale ? "stale" : "fresh" });
  }
  return [...fresh, ...stale];
}

// ---------- GraphQL 查询 ----------

const CHARACTER_RANKINGS_QUERY = `
query CharacterRankings($encounterId: Int!, $bracket: Int, $className: String, $specName: String, $metric: CharacterRankingMetricType) {
  worldData {
    encounter(id: $encounterId) {
      characterRankings(
        bracket: $bracket
        className: $className
        specName: $specName
        metric: $metric
        leaderboard: LogsOnly
        page: 1
      )
    }
  }
}`;

const FIGHT_RANKINGS_QUERY = `
query FightRankings($encounterId: Int!, $bracket: Int) {
  worldData {
    encounter(id: $encounterId) {
      fightRankings(
        bracket: $bracket
        metric: speed
        leaderboard: LogsOnly
        page: 1
      )
    }
  }
}`;

/** 单场战斗的 dungeonPulls（路线）。dungeonPulls 挂在 ReportFight 上（非 Report）。 */
const PULLS_QUERY = `
query ReportFightPulls($code: String!, $fightId: Int) {
  reportData {
    report(code: $code) {
      fights(fightIDs: [$fightId]) {
        id
        dungeonPulls {
          id
          name
          encounterID
          kill
          startTime
          endTime
          enemyNPCs { id gameID }
        }
      }
    }
  }
}`;

/** 候选详情：fights（含 dungeonPulls）+ masterData + rankings（Key %/Parse %）。
 *  report.startTime（绝对 epoch 毫秒）+ fight.startTime（相对报告起点毫秒）→ 候选战斗绝对时间，
 *  用于时效过滤（RECENCY_DAYS / MAX_AGE_DAYS）。 */
const DETAIL_QUERY = `
query ReportDetail($code: String!, $fightId: Int) {
  reportData {
    report(code: $code) {
      startTime
      fights(killType: Kills) {
        id
        name
        difficulty
        keystoneLevel
        keystoneTime
        kill
        startTime
        endTime
        friendlyPlayers
        friendlySpecs
        dungeonPulls {
          id
          name
          encounterID
          kill
          startTime
          endTime
          enemyNPCs { id gameID }
        }
      }
      masterData { actors(type: "Player") { id name subType type } }
      rankings(fightIDs: [$fightId], playerMetric: dps)
    }
  }
}`;

interface RawPullNpc {
  id?: number | null;
  gameID?: number | null;
}
interface RawPull {
  id: number;
  name?: string | null;
  encounterID?: number | null;
  kill?: boolean | null;
  startTime?: number | null;
  endTime?: number | null;
  enemyNPCs?: RawPullNpc[] | null;
}

function parseRawPulls(raw: unknown): DungeonPull[] {
  if (!Array.isArray(raw)) return [];
  const out: DungeonPull[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const r = p as RawPull;
    out.push({
      id: r.id,
      name: r.name ?? "",
      encounterID: r.encounterID ?? 0,
      startTime: r.startTime ?? 0,
      endTime: r.endTime ?? r.startTime ?? 0,
      npcs: (r.enemyNPCs ?? [])
        .filter((n) => n && typeof n.gameID === "number" && n.gameID > 0)
        .map((n) => ({ gameId: n.gameID ?? null, name: null })),
    });
  }
  return out;
}

async function fillPullNpcNames(
  region: WclRegion,
  token: string,
  pulls: DungeonPull[],
  deps: RankingsDeps,
): Promise<DungeonPull[]> {
  const ids = new Set<number>();
  for (const p of pulls) for (const n of p.npcs) if (n.gameId != null) ids.add(n.gameId);
  if (ids.size === 0) return pulls;
  let names: Map<number, string>;
  try {
    names = await resolveNpcNames(region, token, ids, deps);
  } catch {
    return pulls;
  }
  for (const p of pulls) {
    for (const n of p.npcs) {
      if (n.gameId != null) n.name = names.get(n.gameId) ?? null;
    }
  }
  return pulls;
}

/** 单份报告某场战斗的 dungeonPulls（含 NPC 名解析）。供"用户报告路线指纹"复用。 */
export async function fetchReportPulls(
  region: WclRegion,
  token: string,
  code: string,
  fightId: number,
  deps: RankingsDeps,
): Promise<DungeonPull[]> {
  const { data } = await gqlQuery<{
    reportData?: { report?: { fights?: { dungeonPulls?: unknown }[] | null } | null } | null;
  }>(region, token, PULLS_QUERY, { code, fightId }, deps.fetchFn);
  const fight = data.reportData?.report?.fights?.[0];
  const pulls = parseRawPulls(fight?.dungeonPulls);
  return fillPullNpcNames(region, token, pulls, deps);
}

interface RawFight {
  id: number;
  name?: string | null;
  difficulty?: number | null;
  keystoneLevel?: number | null;
  keystoneTime?: number | null;
  kill?: boolean | null;
  startTime?: number | null;
  endTime?: number | null;
  friendlyPlayers?: number[] | null;
  friendlySpecs?: string[] | null;
  dungeonPulls?: unknown;
}

/** 候选报告详情（阵容 + 路线 + Key %/Parse %）。 */
export interface ReportDetail {
  fights: {
    id: number;
    name: string;
    keystoneLevel: number | null;
    success: boolean;
    durationSec: number;
    /** 战斗开始（相对报告起点毫秒），用于路线指纹对齐。 */
    startTime: number;
    endTime: number;
    /** 战斗开始的绝对时间（epoch 毫秒）＝ report.startTime + fight.startTime；缺一不可时为 null。 */
    startTimeMs: number | null;
    friendlySpecs: string[];
    pulls: DungeonPull[];
  }[];
  players: WclPlayer[];
  keyPercent: number | null;
  parsePercent: number | null;
}

async function fetchReportDetail(
  region: WclRegion,
  token: string,
  code: string,
  fightId: number | null,
  spec: string,
  deps: RankingsDeps,
): Promise<ReportDetail> {
  const { data } = await gqlQuery<{
    reportData?: {
      report?: {
        startTime?: number | null;
        fights?: RawFight[] | null;
        masterData?: { actors?: { id?: number | null; name?: string | null; subType?: string | null; type?: string | null }[] | null } | null;
        rankings?: unknown;
      } | null;
    } | null;
  }>(region, token, DETAIL_QUERY, { code, fightId }, deps.fetchFn);
  const report = data.reportData?.report;
  const reportStartTimeMs = report?.startTime ?? null;
  const fights = (report?.fights ?? []).filter((f) => f.keystoneLevel != null);
  const { players } = buildPlayers(
    report?.masterData?.actors ?? [],
    fights.map((f) => ({ id: f.id, friendlyPlayers: f.friendlyPlayers, friendlySpecs: f.friendlySpecs })),
  );
  const percents = extractSpecPercents(report?.rankings, spec);
  return {
    fights: fights.map((f) => ({
      id: f.id,
      name: f.name ?? "",
      keystoneLevel: f.keystoneLevel ?? null,
      success: f.kill ?? false,
      durationSec:
        f.startTime != null && f.endTime != null ? Math.round((f.endTime - f.startTime) / 1000) : 0,
      startTime: f.startTime ?? 0,
      endTime: f.endTime ?? f.startTime ?? 0,
      startTimeMs:
        reportStartTimeMs != null && f.startTime != null ? reportStartTimeMs + f.startTime : null,
      friendlySpecs: f.friendlySpecs ?? [],
      pulls: parseRawPulls(f.dungeonPulls),
    })),
    players,
    keyPercent: percents.keyPercent,
    parsePercent: percents.parsePercent,
  };
}

/** 从候选详情中挑选"层数范围内"的那场（优先精确 fightId，其次精确层数，再其次最近）。 */
function selectCandidateFight(
  fights: ReportDetail["fights"],
  fightId: number | null,
  level: number,
  range: number,
): ReportDetail["fights"][number] | undefined {
  if (fights.length === 0) return undefined;
  if (fightId !== null) {
    const byId = fights.find((f) => f.id === fightId);
    if (byId) return byId;
  }
  const lo = level - range;
  const hi = level + range;
  const inRange = fights.filter((f) => f.keystoneLevel != null && f.keystoneLevel >= lo && f.keystoneLevel <= hi);
  const pool = inRange.length > 0 ? inRange : fights;
  const exact = pool.find((f) => f.keystoneLevel === level);
  if (exact) return exact;
  return [...pool].sort(
    (a, b) =>
      Math.abs((a.keystoneLevel ?? level) - level) - Math.abs((b.keystoneLevel ?? level) - level) ||
      (b.keystoneLevel ?? 0) - (a.keystoneLevel ?? 0),
  )[0];
}

// ---------- 候选搜索缓存（配额保护） ----------

interface CachedCandidates {
  entries: RankingEntry[];
  at: number;
}

const SEARCH_CACHE = new Map<string, CachedCandidates>();

function searchCacheKey(region: WclRegion, dungeon: string, level: number, spec: string): string {
  return `${region}|${dungeon}|${level}|${spec}`;
}

function readSearchCache(key: string): RankingEntry[] | null {
  const hit = SEARCH_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= RANKING_CACHE_TTL_MS) {
    SEARCH_CACHE.delete(key);
    return null;
  }
  return hit.entries;
}

function writeSearchCache(key: string, entries: RankingEntry[]): void {
  if (SEARCH_CACHE.size >= RANKING_CACHE_MAX && !SEARCH_CACHE.has(key)) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of SEARCH_CACHE) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey !== null) SEARCH_CACHE.delete(oldestKey);
  }
  SEARCH_CACHE.set(key, { entries, at: Date.now() });
}

/** 测试用：清空候选搜索缓存。 */
export function clearSearchCache(): void {
  SEARCH_CACHE.clear();
}

// ---------- 真实候选搜索 ----------

async function fetchRankingsBracket(
  region: WclRegion,
  token: string,
  encounterId: number,
  level: number,
  spec: string,
  playerClass: string | null | undefined,
  deps: RankingsDeps,
): Promise<RankingEntry[]> {
  const metric = rankingMetric();
  const specSlug = wclSlug(spec);
  const classSlug = playerClass ? wclSlug(playerClass) : "";
  const canCharacter = specSlug !== "" && specSlug !== "unknown" && classSlug !== "" && classSlug !== "unknown";
  const bracket = level - 1; // bracket = 层数 - 1（真实探测核实）
  try {
    if (canCharacter) {
      const { data } = await gqlQuery<{
        worldData?: { encounter?: { characterRankings?: unknown } | null } | null;
      }>(region, token, CHARACTER_RANKINGS_QUERY, { encounterId, bracket, className: classSlug, specName: specSlug, metric }, deps.fetchFn);
      return parseRankingEntries(data.worldData?.encounter?.characterRankings).map((e) => ({
        ...e,
        metricName: metric,
      }));
    }
    const { data } = await gqlQuery<{
      worldData?: { encounter?: { fightRankings?: unknown } | null } | null;
    }>(region, token, FIGHT_RANKINGS_QUERY, { encounterId, bracket }, deps.fetchFn);
    return parseRankingEntries(data.worldData?.encounter?.fightRankings);
  } catch {
    return [];
  }
}

async function searchCandidates(
  region: WclRegion,
  token: string,
  encounterId: number,
  level: number,
  spec: string,
  playerClass: string | null | undefined,
  range: number,
  deps: RankingsDeps,
): Promise<RankingEntry[]> {
  const levels = new Set<number>();
  for (let l = level - range; l <= level + range; l++) {
    if (l >= 2) levels.add(l);
  }
  const all: RankingEntry[] = [];
  for (const l of levels) {
    const entries = await fetchRankingsBracket(region, token, encounterId, l, spec, playerClass, deps);
    all.push(...entries);
  }
  return sortByAmountDesc(limitEntries(dedupeByCode(all), RANKING_CANDIDATE_LIMIT));
}

// ---------- mock ----------

function mockPulls(seed: number): DungeonPull[] {
  const trash = (i: number, names: string[]) => ({
    id: seed * 100 + i,
    name: `Pull ${i}`,
    encounterID: 0,
    startTime: i * 30_000,
    endTime: i * 30_000 + 20_000,
    npcs: names.map((name, j) => ({ gameId: seed * 1000 + i * 10 + j, name })),
  });
  const boss = (i: number, name: string) => ({
    id: seed * 100 + 90 + i,
    name,
    encounterID: 900 + i,
    startTime: 120_000 + i * 180_000,
    endTime: 120_000 + i * 180_000 + 90_000,
    npcs: [{ gameId: seed * 5000 + i, name }],
  });
  return [
    trash(1, ["Mistcaller", "Spinemaw Staghorn", "Spinemaw Staghorn"]),
    trash(2, ["Drust Soulcleaver", "Drust Soulcleaver", "Mistcaller"]),
    boss(1, "Ingra Maloch"),
    trash(3, ["Spinemaw Staghorn", "Tirnenn Villager"]),
    boss(2, "Mistcaller"),
  ];
}

function mockRecommendations(input: RecommendReferencesInput): ReferenceRecommendation[] {
  const comps = [
    buildCompProfile([
      { class: "Warrior", spec: "Protection" },
      { class: "Shaman", spec: "Restoration" },
      { class: "Mage", spec: "Fire" },
      { class: "Rogue", spec: "Assassination" },
      { class: "Druid", spec: "Balance" },
    ]),
    buildCompProfile([
      { class: "Paladin", spec: "Protection" },
      { class: "Priest", spec: "Holy" },
      { class: "Mage", spec: "Fire" },
      { class: "Hunter", spec: "Beast Mastery" },
      { class: "Druid", spec: "Balance" },
    ]),
    buildCompProfile([
      { class: "Warrior", spec: "Protection" },
      { class: "Shaman", spec: "Restoration" },
      { class: "Warrior", spec: "Arms" },
      { class: "Rogue", spec: "Outlaw" },
      { class: "Monk", spec: "Windwalker" },
    ]),
  ];
  const routes = [
    dungeonPullsToFingerprint(input.dungeon, mockPulls(1), { runStartMs: 0, durationMs: 500_000 }),
    dungeonPullsToFingerprint(input.dungeon, mockPulls(2), { runStartMs: 0, durationMs: 500_000 }),
    null,
  ];
  // Key % 故意与相似度错开，验证"Key % 优先"排序（MOCK3 Key % 最高但阵容最不相似）
  const metas = [
    { keyPercent: 88, parsePercent: 96, amount: 11_000, score: 320, medal: "silver", success: true },
    { keyPercent: 72, parsePercent: 85, amount: 9_800, score: 300, medal: "none", success: true },
    { keyPercent: 95, parsePercent: 99, amount: 12_345, score: 335, medal: "gold", success: false },
  ];
  const user: ReferenceProfile = {
    id: "user",
    dungeon: input.dungeon,
    level: input.level,
    route: input.userRoute ?? undefined,
    comp: input.userComp ?? undefined,
  };
  const ids = ["MOCK1", "MOCK2", "MOCK3"];
  const items = ids.map((id, i) => {
    const profile: ReferenceProfile = { id, dungeon: input.dungeon, level: input.level, comp: comps[i], route: routes[i] ?? undefined };
    const cmp = compareReference(user, profile);
    return {
      code: id,
      fightId: 100 + i,
      dungeon: input.dungeon,
      level: input.level,
      success: metas[i].success,
      durationSec: 500 + i * 30,
      keyPercent: metas[i].keyPercent,
      parsePercent: metas[i].parsePercent,
      amount: metas[i].amount,
      score: metas[i].score,
      medal: metas[i].medal,
      metricName: "dps",
      compSimilarity: cmp.compSimilarity,
      routeSimilarity: cmp.routeSimilarity,
      combined: cmp.combined,
    };
  });
  return rankRecommendations(items).map((c) => ({
    ...c,
    // mock 无真实 WCL 数据：不伪造战斗时间，前端日期列显示"日期未知"、不参与时效过滤。
    fightStartTimeMs: null,
    stale: false,
    url: `https://www.warcraftlogs.com/reports/${c.code}#fight=${c.fightId}`,
  }));
}

// ---------- 并行工具 ----------

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        results[idx] = await fn(items[idx]);
      } catch {
        results[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------- 统一入口 ----------

/**
 * 自动搜索并推荐参考 log（候选搜索 + 详情 + "Key % 优先，相似度其次"排序）。
 * 任一环节失败都静默降级（返回 ok:true 但 candidates 为空 + degradedReason），不抛错。
 */
export async function recommendReferences(
  input: RecommendReferencesInput,
  deps: RankingsDeps = {},
): Promise<ReferenceSearchResult> {
  const region = input.region;
  const range = rangeLevels();

  const useReal = Boolean(
    (deps.clientId ?? envConfig.wclClientId) && (deps.clientSecret ?? envConfig.wclClientSecret),
  );
  if (!useReal || input.isMock) {
    return { ok: true, candidates: mockRecommendations(input) };
  }
  requireProductionEnv("WCL_CLIENT_ID", "WCL_CLIENT_SECRET");

  const cacheKey = searchCacheKey(region, input.dungeon, input.level, input.spec);
  const cached = readSearchCache(cacheKey);

  let entries: RankingEntry[];
  if (cached) {
    entries = cached;
  } else {
    try {
      const token = await getAccessToken(region, deps);
      const encounter = await resolveDungeonEncounter(region, token, input.dungeon, deps);
      if (!encounter) {
        return { ok: true, candidates: [], degradedReason: "未找到该副本的排行数据" };
      }
      entries = await searchCandidates(region, token, encounter.encounterId, input.level, input.spec, input.playerClass, range, deps);
      writeSearchCache(cacheKey, entries);
    } catch (err) {
      if (err instanceof WclGqlError && err.status === 429) {
        return { ok: true, candidates: [], degradedReason: "WCL 配额不足，已跳过自动推荐" };
      }
      return { ok: true, candidates: [], degradedReason: "候选搜索失败" };
    }
  }

  if (entries.length === 0) {
    return { ok: true, candidates: [], degradedReason: "暂无相近层数的参考 log" };
  }

  let token: string;
  try {
    token = await getAccessToken(region, deps);
  } catch {
    return { ok: true, candidates: [], degradedReason: "候选详情获取失败" };
  }

  const details = await mapWithConcurrency(entries, RANKING_PARALLELISM, (entry) =>
    fetchReportDetail(region, token, entry.code, entry.fightId, input.spec, deps),
  );

  const user: ReferenceProfile = {
    id: "user",
    dungeon: input.dungeon,
    level: input.level,
    route: input.userRoute ?? undefined,
    comp: input.userComp ?? undefined,
  };
  const profiles: ReferenceProfile[] = [];
  const metas: {
    code: string;
    fightId: number | null;
    level: number | null;
    success: boolean;
    durationSec: number;
    keyPercent: number | null;
    parsePercent: number | null;
    amount: number | null;
    score: number | null;
    medal: string | null;
    metricName: string | null;
    fightStartTimeMs: number | null;
  }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const detail = details[i];
    if (!detail) continue; // 该候选拉取失败，跳过
    const fight = selectCandidateFight(detail.fights, entry.fightId, input.level, range);
    if (!fight) continue;
    // 专精过滤：候选队伍需含所选专精（空/Unknown 不过滤）
    if (!specMatchesTeam(fight.friendlySpecs, input.spec)) continue;
    let namedPulls: DungeonPull[];
    try {
      namedPulls = await fillPullNpcNames(region, token, fight.pulls, deps);
    } catch {
      namedPulls = fight.pulls;
    }
    const route = dungeonPullsToFingerprint(input.dungeon, namedPulls, {
      runStartMs: fight.startTime,
      durationMs: Math.max(1000, fight.durationSec * 1000),
    });
    const comp = buildCompProfile(detail.players);
    profiles.push({
      id: entry.code,
      dungeon: input.dungeon,
      level: fight.keystoneLevel ?? entry.level ?? input.level,
      route: route ?? undefined,
      comp,
    });
    metas.push({
      code: entry.code,
      fightId: entry.fightId,
      level: fight.keystoneLevel ?? entry.level ?? input.level,
      success: fight.success,
      durationSec: fight.durationSec,
      keyPercent: detail.keyPercent,
      parsePercent: detail.parsePercent,
      amount: entry.amount,
      score: entry.score,
      medal: entry.medal,
      metricName: entry.metricName,
      fightStartTimeMs: fight.startTimeMs,
    });
  }

  if (profiles.length === 0) {
    return { ok: true, candidates: [], degradedReason: "暂无含所选专精的参考 log" };
  }

  // Key % 优先，相似度其次
  const ranked = rankRecommendations(
    profiles.map((profile, i) => {
      const cmp = compareReference(user, profile);
      const meta = metas[i];
      return {
        code: profile.id,
        fightId: meta.fightId,
        level: meta.level,
        success: meta.success,
        durationSec: meta.durationSec,
        keyPercent: meta.keyPercent,
        parsePercent: meta.parsePercent,
        amount: meta.amount,
        score: meta.score,
        medal: meta.medal,
        metricName: meta.metricName,
        fightStartTimeMs: meta.fightStartTimeMs,
        compSimilarity: cmp.compSimilarity,
        routeSimilarity: cmp.routeSimilarity,
        combined: cmp.combined,
      };
    }),
  );
  // 时效过滤与降权：超过 MAX_AGE_DAYS 过滤；RECENCY_DAYS–MAX_AGE_DAYS 之间排后并标注 stale。
  const recencyRanked = rankByRecency(ranked, {
    nowMs: Date.now(),
    recencyDays: recencyDays(),
    maxAgeDays: maxAgeDays(),
  });
  const candidates: ReferenceRecommendation[] = recencyRanked.map(({ item: c, recency }) => ({
    code: c.code,
    fightId: c.fightId,
    dungeon: input.dungeon,
    level: c.level ?? input.level,
    success: c.success,
    durationSec: c.durationSec,
    compSimilarity: c.compSimilarity,
    routeSimilarity: c.routeSimilarity,
    combined: c.combined,
    keyPercent: c.keyPercent,
    parsePercent: c.parsePercent,
    amount: c.amount,
    score: c.score,
    medal: c.medal,
    metricName: c.metricName,
    fightStartTimeMs: c.fightStartTimeMs,
    stale: recency === "stale",
    url: `https://${region === "cn" ? "cn." : "www."}warcraftlogs.com/reports/${c.code}#fight=${c.fightId ?? ""}`,
  }));

  return { ok: true, candidates };
}
