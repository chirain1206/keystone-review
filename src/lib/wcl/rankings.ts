import { envConfig, requireProductionEnv } from "@/lib/env";
import { gqlQuery, getAccessToken, WclGqlError } from "@/lib/wcl/adapter";
import { buildPlayers, type WclPlayer } from "@/lib/wcl/players";
import { resolveNpcNames } from "@/lib/wcl/npc-names";
import { resolveDungeonZone } from "@/lib/wcl/dungeon-zones";
import { dungeonPullsToFingerprint, type DungeonPull } from "@/lib/route/dungeon-pulls";
import { buildCompProfile, type CompProfile } from "@/lib/route/comp-profile";
import { compareReference, type ReferenceProfile } from "@/lib/route/recommend";
import type { RouteFingerprint } from "@/lib/route/fingerprint";

/**
 * WCL 自动对比推荐（FR-3 对比 + FR-12 落地 + 产品补充："表现优先，相似度其次"）。
 *
 * 用户贴 WCL 链接后，自动搜索"同副本、相近层数、该专精玩家自己打得强"的参考 log：
 *  1) 候选搜索：优先 worldData.encounter(id).characterRankings（specName=所选专精，
 *     metric=dps（可配 RANKING_METRIC），bracket=层数，leaderboard=LogsOnly，限定当前分区）——
 *     排行榜天然带"该专精玩家的 parse 分位 + 伤害值"，能直接筛出该专精玩家表现强的报告；
 *     专精未知（空/"Unknown"）时降级为 fightRankings(metric=speed)（团队层数排行，无 parse）。
 *  2) 候选详情：对每个候选拉 fights（层数/成功/时长/阵容）+ dungeonPulls（路线）+ masterData.actors；
 *  3) 排序：主排序 = parse 分位降序（可配 MIN_PARSE_PERCENT 过滤过低者，默认 80）；
 *     次排序 = 路线相似度；再次 = 阵容相似度（dungeonPulls→RouteFingerprint 与 tactical-pulls 兼容）。
 *
 * 配额保护（对齐 TECH-DESIGN "WCL 只做轻量查询" + 事件模块的既有策略）：
 *  - 候选只取前 N（≤10）；详情并行度 ≤3；单候选失败跳过、部分成功也返回；
 *  - 候选搜索结果进程内缓存（key=dungeon+level+spec，TTL 1 小时）；
 *  - zone 解析、NPC 名称各有独立缓存；任一环节失败 → 静默降级为空候选（不阻塞）。
 *
 * 字段名已对照 WCL v2 schema 核实（github.com/math280h/go-wcl schema.graphql，WCL introspection 生成）：
 *  - Encounter.characterRankings(bracket, difficulty, metric, specName, page, leaderboard, …): JSON
 *    （metric 取 CharacterRankingMetricType.dps；leaderboard=LogsOnly=仅含有 log 的排名）
 *  - Encounter.fightRankings(…): JSON（专精未知时的降级路径，metric=speed）
 *  - Report.fights(killType) 含 keystoneLevel/keystoneTime/kill/startTime/endTime/friendlyPlayers/friendlySpecs
 *  - Report.dungeonPulls: [ReportDungeonPull]；ReportDungeonPull.enemyNPCs: [ReportDungeonPullNPC{ id, gameID }]
 *  - 排行 JSON 具体字段（reportID/historicalPercent/amount…）schema 未强类型，此处防御性解析（见 extract*），
 *    字段名待线上验证（完成回报"剩余风险"）。
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

/** 排行指标（RANKING_METRIC 环境变量，默认 "dps"；治疗可改 "hps"、总评可改 "playerscore"）。 */
export function rankingMetric(): string {
  const raw = (process.env.RANKING_METRIC ?? "").trim().toLowerCase();
  return raw || "dps";
}

/** parse 分位过滤阈值（MIN_PARSE_PERCENT 环境变量，默认 80；≤0 或非法 = 不过滤）。 */
export function minParsePercent(): number {
  const raw = process.env.MIN_PARSE_PERCENT;
  if (raw === undefined || raw === "") return 80;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 80;
}

export interface ReferenceRecommendation {
  code: string;
  dungeon: string;
  level: number | null;
  success: boolean;
  durationSec: number;
  compSimilarity: number | null;
  routeSimilarity: number | null;
  /** 综合分（comp + route 均值；无任何可用维度为 null）。 */
  combined: number | null;
  /** 该专精玩家的 parse 分位（0–100；排行源可拿不到时为 null）。 */
  parsePercent: number | null;
  /** 该专精玩家的排行指标值（如 DPS；拿不到时为 null）。 */
  amount: number | null;
  /** 排行指标名（如 "dps"；前端据此展示单位）。 */
  metricName: string | null;
  /** 候选报告 WCL 链接（前端作为对比链接使用）。 */
  url: string;
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
  /** 所选专精（用于过滤候选队伍含该专精；空/"Unknown" 则不过滤）。 */
  spec: string;
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
  fightId?: number | null;
  level: number | null;
  durationSec: number;
  success: boolean;
  /** 该专精玩家的 parse 分位（0–100）；排行源拿不到时为 null。 */
  parsePercent: number | null;
  /** 该专精玩家的排行指标值（如 DPS）；拿不到时为 null。 */
  amount: number | null;
  /** 排行指标名（如 "dps"）。 */
  metricName: string | null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 排行 JSON 里的 report code 字段名不确定，防御性多键提取。 */
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

/** 排行 JSON 里的 fight id 字段名不确定，防御性多键提取。 */
function extractFightId(raw: Record<string, unknown>): number | null {
  for (const k of ["fightID", "fightId", "fight_id", "reportFightID", "reportFightId"]) {
    const v = asNumber(raw[k]);
    if (v !== null) return v;
  }
  return null;
}

/** 排行 JSON 里的层数字段（bracket/keystoneLevel/level）。 */
function extractLevel(raw: Record<string, unknown>): number | null {
  for (const k of ["keystoneLevel", "keyLevel", "keystone_level", "level", "bracket"]) {
    const v = asNumber(raw[k]);
    if (v !== null) return v;
  }
  return null;
}

/** 排行 JSON 里的时长（ms 或秒，防御性判断）；失败返回 null。 */
function extractDurationSec(raw: Record<string, unknown>): number {
  for (const k of ["duration", "keystoneTime", "fightTime", "durationSec"]) {
    const v = asNumber(raw[k]);
    if (v !== null && v > 0) return v >= 1000 ? Math.round(v / 1000) : Math.round(v);
  }
  return 0;
}

/** 排行 JSON 里的成功标记（缺省 true：速度榜通常只含限时）。 */
function extractSuccess(raw: Record<string, unknown>): boolean {
  for (const k of ["kill", "success", "timed", "inTime"]) {
    const v = raw[k];
    if (typeof v === "boolean") return v;
  }
  return true;
}

/**
 * 排行 JSON 里的 parse 分位（0–100）。WCL 常见字段为 historicalPercent（0–100），
 * 也可能给 0–1 的小数；防御性多键提取 + 归一化到 0–100。拿不到返回 null。
 */
function extractParsePercent(raw: Record<string, unknown>): number | null {
  for (const k of ["historicalPercent", "historicalRankPercent", "rankPercent", "parsePercent", "percent"]) {
    const v = asNumber(raw[k]);
    if (v === null) continue;
    const pct = v <= 1 && v > 0 ? v * 100 : v;
    if (pct < 0 || pct > 100) continue;
    return pct;
  }
  return null;
}

/** 排行 JSON 里的指标值（DPS 等）。防御性多键提取；拿不到返回 null。 */
function extractAmount(raw: Record<string, unknown>): number | null {
  for (const k of ["amount", "total", "dps", "score", "value"]) {
    const v = asNumber(raw[k]);
    if (v !== null && v >= 0) return v;
  }
  return null;
}

/**
 * 解析排行 JSON 数组为候选条目；解析失败/缺 code 的条目被跳过（防御性）。
 * 只返回有有效 report code 的条目，层数/时长/parse/指标值尽力填充（拿不到为 null/0）。
 */
export function parseRankingEntries(raw: unknown): RankingEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RankingEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const code = extractCode(rec);
    if (!code) continue;
    out.push({
      code,
      fightId: extractFightId(rec),
      level: extractLevel(rec),
      durationSec: extractDurationSec(rec),
      success: extractSuccess(rec),
      parsePercent: extractParsePercent(rec),
      amount: extractAmount(rec),
      metricName: null,
    });
  }
  return out;
}

/** 层数范围过滤：[level - range, level + range]（range 由 RANGE_LEVELS 决定）。 */
export function filterByLevelRange(
  entries: RankingEntry[],
  level: number,
  range: number,
): RankingEntry[] {
  const lo = level - range;
  const hi = level + range;
  return entries.filter((e) => {
    if (e.level === null) return true; // 未知层数保留（详情阶段再按 fight 层数复核）
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

/** 限时成功优先排序（同为成功/失败时保持相对顺序稳定）。 */
export function sortSuccessFirst(entries: RankingEntry[]): RankingEntry[] {
  return [...entries].sort((a, b) => Number(b.success) - Number(a.success));
}

/** parse 分位降序排序（无 parse 的排最后，保持相对顺序稳定）。 */
export function sortByParseDesc(entries: RankingEntry[]): RankingEntry[] {
  return [...entries].sort((a, b) => (b.parsePercent ?? -1) - (a.parsePercent ?? -1));
}

/**
 * parse 分位过滤：过滤 parse 过低者（< threshold）。
 * parse 为 null（排行源拿不到，如专精未知降级路径）保留——无法判定，交给后续相似度兜底。
 */
export function filterByMinParse(entries: RankingEntry[], threshold: number): RankingEntry[] {
  if (threshold <= 0) return [...entries];
  return entries.filter((e) => e.parsePercent === null || e.parsePercent >= threshold);
}

/** 最终推荐排序的候选形状（parse + 路线 + 阵容）。 */
export interface RankableCandidate {
  parsePercent: number | null;
  routeSimilarity: number | null;
  compSimilarity: number | null;
}

/**
 * "表现优先，相似度其次"排序：
 *  主排序 = parse 分位降序（无 parse 排最后）；次排序 = 路线相似度降序；再次 = 阵容相似度降序。
 * 纯函数，返回新数组，不改动入参。
 */
export function rankRecommendations<T extends RankableCandidate>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const pa = a.parsePercent ?? -1;
    const pb = b.parsePercent ?? -1;
    if (pa !== pb) return pb - pa;
    const ra = a.routeSimilarity ?? -1;
    const rb = b.routeSimilarity ?? -1;
    if (ra !== rb) return rb - ra;
    return (b.compSimilarity ?? -1) - (a.compSimilarity ?? -1);
  });
}

/** 专精名归一化（大小写/空格/连字符不敏感），用于"候选队伍含该专精"过滤。 */
export function normalizeSpec(spec: string): string {
  return spec.trim().toLowerCase().replace(/[\s\-_']/g, "");
}

/**
 * 候选队伍专精过滤：候选阵容（friendlySpecs）含指定专精才保留。
 * spec 为空/"Unknown" 时不过滤（返回 true）。
 */
export function specMatchesTeam(specs: readonly (string | null | undefined)[], spec: string): boolean {
  const target = normalizeSpec(spec);
  if (!target || target === "unknown") return true;
  return specs.some((s) => s != null && normalizeSpec(s) === target);
}

// ---------- GraphQL 查询 ----------

/** 排行榜查询（优先路径）：按专精过滤的个体表现排行（parse 分位 + 指标值）。 */
const CHARACTER_RANKINGS_QUERY = `
query CharacterRankings($encounterId: Int!, $bracket: Int, $specName: String, $metric: CharacterRankingMetricType) {
  worldData {
    encounter(id: $encounterId) {
      characterRankings(
        bracket: $bracket
        specName: $specName
        metric: $metric
        leaderboard: LogsOnly
        page: 1
      )
    }
  }
}`;

/** 排行榜查询（降级路径）：专精未知时的团队层数排行（无 parse/指标）。 */
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

const PULLS_QUERY = `
query ReportPulls($code: String!) {
  reportData {
    report(code: $code) {
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
}`;

const DETAIL_QUERY = `
query ReportDetail($code: String!) {
  reportData {
    report(code: $code) {
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
      }
      masterData { actors(type: "Player") { id name subType type } }
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

/** 解析 dungeonPulls 原始返回 → DungeonPull[]（enemyNPCs 的 gameID 保留，名称后解析）。 */
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

/** 用 gameData.npc 解析 pulls 内 NPC 名称（best-effort，失败保留 null）。 */
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

/**
 * 单份报告的 dungeonPulls（含 NPC 名解析）。供"用户报告路线指纹"复用：
 * 自动对比推荐需要用户自己的路线（来自用户报告 dungeonPulls）才能算路线相似度。
 */
export async function fetchReportPulls(
  region: WclRegion,
  token: string,
  code: string,
  deps: RankingsDeps,
): Promise<DungeonPull[]> {
  const { data } = await gqlQuery<{
    reportData?: { report?: { dungeonPulls?: unknown } | null } | null;
  }>(region, token, PULLS_QUERY, { code }, deps.fetchFn);
  const pulls = parseRawPulls(data.reportData?.report?.dungeonPulls);
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
}

/** 候选报告详情（阵容 + 路线 + 场次）。 */
export interface ReportDetail {
  fights: {
    id: number;
    name: string;
    keystoneLevel: number | null;
    success: boolean;
    durationSec: number;
    startTime: number;
    endTime: number;
    friendlySpecs: string[];
  }[];
  players: WclPlayer[];
  dungeonPulls: DungeonPull[];
}

async function fetchReportDetail(
  region: WclRegion,
  token: string,
  code: string,
  deps: RankingsDeps,
): Promise<ReportDetail> {
  const { data } = await gqlQuery<{
    reportData?: {
      report?: {
        fights?: RawFight[] | null;
        masterData?: { actors?: { id?: number | null; name?: string | null; subType?: string | null; type?: string | null }[] | null } | null;
        dungeonPulls?: unknown;
      } | null;
    } | null;
  }>(region, token, DETAIL_QUERY, { code }, deps.fetchFn);
  const report = data.reportData?.report;
  const fights = (report?.fights ?? []).filter((f) => f.keystoneLevel != null);
  const { players } = buildPlayers(
    report?.masterData?.actors ?? [],
    fights.map((f) => ({ id: f.id, friendlyPlayers: f.friendlyPlayers, friendlySpecs: f.friendlySpecs })),
  );
  const pulls = parseRawPulls(report?.dungeonPulls);
  const namedPulls = await fillPullNpcNames(region, token, pulls, deps);
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
      friendlySpecs: f.friendlySpecs ?? [],
    })),
    players,
    dungeonPulls: namedPulls,
  };
}

/** 从候选详情中挑选"层数范围内"的那场（优先精确层数，其次最近，再其次最高）。 */
function selectCandidateFight(
  fights: ReportDetail["fights"],
  level: number,
  range: number,
): ReportDetail["fights"][number] | undefined {
  if (fights.length === 0) return undefined;
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

/** 单个层数 bracket 的排行拉取（专精已知走 characterRankings，未知走 fightRankings）。失败返回空。 */
async function fetchRankingsBracket(
  region: WclRegion,
  token: string,
  encounterId: number,
  bracket: number,
  spec: string,
  deps: RankingsDeps,
): Promise<RankingEntry[]> {
  const targetSpec = normalizeSpec(spec);
  const metric = rankingMetric();
  try {
    if (targetSpec && targetSpec !== "unknown") {
      const { data } = await gqlQuery<{
        worldData?: { encounter?: { characterRankings?: unknown } | null } | null;
      }>(region, token, CHARACTER_RANKINGS_QUERY, { encounterId, bracket, specName: targetSpec, metric }, deps.fetchFn);
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

/** 按层数范围 [level-range, level+range] 拉取候选（多 bracket 合并，去重，parse 过滤 + parse 降序）。 */
async function searchCandidates(
  region: WclRegion,
  token: string,
  encounterId: number,
  level: number,
  spec: string,
  range: number,
  deps: RankingsDeps,
): Promise<RankingEntry[]> {
  const levels = new Set<number>();
  for (let l = level - range; l <= level + range; l++) {
    if (l >= 2) levels.add(l);
  }
  const all: RankingEntry[] = [];
  for (const l of levels) {
    const entries = await fetchRankingsBracket(region, token, encounterId, l, spec, deps);
    all.push(...entries);
  }
  const deduped = dedupeByCode(all);
  const filtered = filterByMinParse(deduped, minParsePercent());
  return sortByParseDesc(limitEntries(filtered, RANKING_CANDIDATE_LIMIT));
}

// ---------- mock ----------

function mockPlayers(): { class: string; spec: string }[] {
  return [
    { class: "Warrior", spec: "Protection" },
    { class: "Shaman", spec: "Restoration" },
    { class: "Mage", spec: "Fire" },
    { class: "Rogue", spec: "Assassination" },
    { class: "Druid", spec: "Balance" },
  ];
}

/** mock 路线（3 波 trash + 2 boss），构造候选与用户报告都可用的合成路线。 */
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

/** mock 候选：构造 3 个候选（阵容从相近到差异 + parse 表现），走与真实一致的相似度/排序代码路径。 */
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
  // parse 表现故意与相似度错开，验证"表现优先"排序
  const metas = [
    { parsePercent: 92, amount: 12_345, success: true },
    { parsePercent: 88, amount: 11_000, success: true },
    { parsePercent: 96, amount: 9_800, success: false },
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
    const profile: ReferenceProfile = {
      id,
      dungeon: input.dungeon,
      level: input.level,
      comp: comps[i],
      route: routes[i] ?? undefined,
    };
    const cmp = compareReference(user, profile);
    return {
      code: id,
      dungeon: input.dungeon,
      level: input.level,
      success: metas[i].success,
      durationSec: 500 + i * 30,
      parsePercent: metas[i].parsePercent,
      amount: metas[i].amount,
      metricName: "dps",
      compSimilarity: cmp.compSimilarity,
      routeSimilarity: cmp.routeSimilarity,
      combined: cmp.combined,
    };
  });
  return rankRecommendations(items).map((c) => ({
    ...c,
    url: `https://www.warcraftlogs.com/reports/${c.code}`,
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
 * 自动搜索并推荐参考 log（候选搜索 + 详情 + 相似度排序）。
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
      const zone = await resolveDungeonZone(region, token, input.dungeon, deps);
      if (!zone || zone.encounterId == null) {
        return {
          ok: true,
          candidates: [],
          degradedReason: "未找到该副本的排行数据",
        };
      }
      entries = await searchCandidates(region, token, zone.encounterId, input.level, input.spec, range, deps);
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

  // 候选详情（并行 ≤3，失败跳过，部分成功也返回）
  let token: string;
  try {
    token = await getAccessToken(region, deps);
  } catch {
    return { ok: true, candidates: [], degradedReason: "候选详情获取失败" };
  }

  const details = await mapWithConcurrency(entries, RANKING_PARALLELISM, (entry) =>
    fetchReportDetail(region, token, entry.code, deps),
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
    level: number | null;
    success: boolean;
    durationSec: number;
    parsePercent: number | null;
    amount: number | null;
    metricName: string | null;
  }[] = [];

  details.forEach((detail, i) => {
    const entry = entries[i];
    if (!detail) return; // 该候选拉取失败，跳过
    const fight = selectCandidateFight(detail.fights, input.level, range);
    if (!fight) return;
    // 专精过滤：候选队伍需含所选专精（空/Unknown 不过滤）
    if (!specMatchesTeam(fight.friendlySpecs, input.spec)) return;
    const route = dungeonPullsToFingerprint(input.dungeon, detail.dungeonPulls, {
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
      level: fight.keystoneLevel ?? entry.level ?? input.level,
      success: fight.success,
      durationSec: fight.durationSec,
      parsePercent: entry.parsePercent,
      amount: entry.amount,
      metricName: entry.metricName,
    });
  });

  if (profiles.length === 0) {
    return { ok: true, candidates: [], degradedReason: "暂无含所选专精的参考 log" };
  }

  // 表现优先，相似度其次（parse 降序 → 路线相似度降序 → 阵容相似度降序）
  const ranked = rankRecommendations(
    profiles.map((profile, i) => {
      const cmp = compareReference(user, profile);
      const meta = metas[i];
      return {
        code: profile.id,
        level: meta.level,
        success: meta.success,
        durationSec: meta.durationSec,
        parsePercent: meta.parsePercent,
        amount: meta.amount,
        metricName: meta.metricName,
        compSimilarity: cmp.compSimilarity,
        routeSimilarity: cmp.routeSimilarity,
        combined: cmp.combined,
      };
    }),
  );
  const candidates: ReferenceRecommendation[] = ranked.map((c) => ({
    code: c.code,
    dungeon: input.dungeon,
    level: c.level ?? input.level,
    success: c.success,
    durationSec: c.durationSec,
    compSimilarity: c.compSimilarity,
    routeSimilarity: c.routeSimilarity,
    combined: c.combined,
    parsePercent: c.parsePercent,
    amount: c.amount,
    metricName: c.metricName,
    url: `https://${region === "cn" ? "cn." : "www."}warcraftlogs.com/reports/${c.code}`,
  }));

  return { ok: true, candidates };
}
