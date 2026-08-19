import { envConfig, requireProductionEnv } from "@/lib/env";
import { buildPlayers, mockPlayers, type WclPlayer } from "@/lib/wcl/players";

/**
 * WCL v2 请求统一 User-Agent（WCL 对无 UA 的请求会返回 HTML 错误页）。
 * 所有发往 *.warcraftlogs.com 的 fetch（OAuth + GraphQL）都必须携带此头。
 */
export const WCL_USER_AGENT = "wow-analyzer/0.1";

/**
 * WCL v2 API 适配器（T8，FR-1/FR-3）。
 *  - 有 WCL_CLIENT_ID/SECRET → 真实 OAuth client_credentials + GraphQL 查询
 *    （www 与 cn 域各自对应官方 API 端点；只做轻量元数据查询）
 *  - 无密钥（开发/mock）→ 根据链接结构合成元数据，流程可离线自测
 * 失败分级（FR-1 验收，用户引导式文案）：
 *   INVALID_LINK    链接无效/过期 → "链接无效或报告已过期，请检查后重新粘贴，或上传日志文件"
 *   NOT_MYTHIC      团本 → "第一版仅支持大秘境分析，请重新粘贴大秘境 log 链接，或上传战斗日志文件"
 *   NO_MYTHIC_FIGHT 无大秘境战斗 → "该报告中没有大秘境战斗，请更换链接或上传日志文件"
 *   FETCH_FAILED    API 网络/配额失败 → "WCL 数据获取失败（网络或平台故障），请稍后重试或上传日志文件"
 */

export interface WclFight {
  id: number;
  name: string; // 副本/首领名（游戏原名）
  difficulty: number;
  keystoneLevel: number | null; // 大秘境层数；团本为 null
  affixes: string[];
  success: boolean;
  durationSec: number;
  /** 战斗开始（相对报告起点毫秒），用于事件时间戳对齐。 */
  startTime?: number;
  /** 战斗结束（相对报告起点毫秒）。 */
  endTime?: number;
  playerName: string; // 报告主角（best-effort）
  playerClass: string;
  playerSpec: string;
  /** 链接 ?fight=N（数字）或 ?fight=last 指定的场次，作为前端默认选中/高亮（不丢失其余场次）。 */
  selected?: boolean;
  /** 该场战斗实际参与的玩家 actor id 列表（WCL Fight.friendlyPlayers），用于复盘对象按场次过滤。 */
  friendlyPlayers?: number[] | null;
}

export interface WclReportMeta {
  code: string;
  title: string;
  fights: WclFight[];
  /** 报告涉及的玩家（名字/职业/专精），供前端选择复盘对象。 */
  players: WclPlayer[];
  /** 报告上传者账号名（best-effort 识别角色用）。 */
  uploaderName?: string;
  /** true = mock 合成数据（未配置 WCL 密钥），前端据此显示"演示数据"标注。 */
  isMock?: boolean;
}

export type WclErrorCode = "INVALID_LINK" | "NOT_MYTHIC" | "FETCH_FAILED" | "NO_MYTHIC_FIGHT";

export type WclResult =
  | { ok: true; meta: WclReportMeta }
  | { ok: false; code: WclErrorCode; message: string };

/** 场次提示：链接 ?fight=N（数字，按场次 id 预选）或 ?fight=last（最后一场大秘境）。 */
export type WclFightHint = number | "last";

/** 从 URL 的 query 与 hash 中提取 fight 提示（数字或 "last"），忽略 type/source 等视图参数。 */
function extractFightHint(url: URL): WclFightHint | undefined {
  // 查询参数优先于 hash（与旧实现一致）
  const fromQuery = paramFromSearch(url.searchParams);
  if (fromQuery !== undefined) return fromQuery;
  return paramFromHash(url.hash);
}

/** 从 URLSearchParams 中取 fight 参数（键名大小写不敏感；值已由 URL 自动百分号解码）。 */
function paramFromSearch(params: URLSearchParams): WclFightHint | undefined {
  return parseFightValue(findFightParam(params));
}

/** hash 片段可能形如 "#fight=7"、"#fight=7&type=damage-done" 或 "#?fight=7"。 */
function paramFromHash(hash: string): WclFightHint | undefined {
  const raw = hash.replace(/^#/, "");
  if (!raw) return undefined;
  const qs = raw.startsWith("?") ? raw.slice(1) : raw;
  return parseFightValue(findFightParam(new URLSearchParams(qs)));
}

/** 大小写不敏感地查找 fight 参数（兼容 ?FIGHT=N / ?Fight=N）。 */
function findFightParam(params: URLSearchParams): string | null {
  for (const key of params.keys()) {
    if (key.toLowerCase() === "fight") return params.get(key);
  }
  return null;
}

/** 归一化 fight 值："last" 大小写不敏感；数字需为正整数；其余（type/source 等）视为无提示。 */
function parseFightValue(raw: string | null): WclFightHint | undefined {
  if (raw === null) return undefined;
  const v = raw.trim();
  if (v === "") return undefined;
  if (v.toLowerCase() === "last") return "last";
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * 用 WHATWG URL 解析替代/增强正则：接受
 * `https://(www|cn).warcraftlogs.com/reports/CODE` 后跟任意 query 与 hash。
 * 兼容大写（路径/参数名/值）与 URL 编码（new URL + URLSearchParams 自动解码）。
 */
export function parseWclUrl(url: string): {
  ok: boolean;
  code?: string;
  region?: "www" | "cn";
  fight?: WclFightHint;
} {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return { ok: false };
  }
  if (u.protocol !== "https:") return { ok: false };

  const host = u.hostname.toLowerCase();
  let region: "www" | "cn";
  if (host === "cn.warcraftlogs.com") region = "cn";
  else if (host === "www.warcraftlogs.com" || host === "warcraftlogs.com") region = "www";
  else return { ok: false };

  // 路径形如 /reports/CODE（可选尾斜杠）；i 标志兼容大写路径，code 保留大小写。
  const m = /^\/reports\/([A-Za-z0-9]+)\/?$/i.exec(u.pathname);
  if (!m) return { ok: false };

  return {
    ok: true,
    code: m[1],
    region,
    fight: extractFightHint(u),
  };
}

/**
 * 从一场报告的多场大秘境中选出要复盘的那场（FR-1/FR-3 默认选中）：
 *  1) 显式 fightId（来自请求体）命中 → 用它；
 *  2) 链接 ?fight=N 标记的 selected 场次 → 默认选中；
 *  3) 否则取层数最高的一场（保持历史行为）。
 */
export function selectFight(fights: WclFight[], requestedId?: number): WclFight | undefined {
  if (fights.length === 0) return undefined;
  if (requestedId !== undefined) {
    const byId = fights.find((f) => f.id === requestedId);
    if (byId) return byId;
  }
  const selected = fights.find((f) => f.selected);
  if (selected) return selected;
  return [...fights].sort((a, b) => (b.keystoneLevel ?? 0) - (a.keystoneLevel ?? 0))[0];
}

// ---------- 真实 API ----------

interface OAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  error?: string;
}

/** 测试注入点：fetch 与凭证可覆写（缺省读 envConfig）。 */
export interface WclOAuthDeps {
  fetchFn?: typeof fetch;
  clientId?: string;
  clientSecret?: string;
}

/**
 * 获取 WCL OAuth2 client_credentials 访问令牌（RFC 6749 §4.4/§2.3.1）。
 * 凭证以 HTTP Basic 头携带：Authorization: Basic base64(client_id:client_secret)。
 * 官方端点为 https://{www|cn}.warcraftlogs.com/oauth/token。
 */
export async function getAccessToken(
  region: "www" | "cn",
  deps: WclOAuthDeps = {},
): Promise<string> {
  const clientId = deps.clientId ?? envConfig.wclClientId;
  const clientSecret = deps.clientSecret ?? envConfig.wclClientSecret;
  if (!clientId || !clientSecret) {
    throw new Error("缺少 WCL_CLIENT_ID / WCL_CLIENT_SECRET 配置，无法获取 WCL 访问令牌");
  }
  const host = region === "cn" ? "cn.warcraftlogs.com" : "www.warcraftlogs.com";
  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const fetchFn = deps.fetchFn ?? fetch;
  const res = await fetchFn(`https://${host}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
      "User-Agent": WCL_USER_AGENT,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`WCL OAuth ${res.status}`);
  const data = (await res.json()) as OAuthTokenResponse;
  if (!data.access_token) throw new Error(data.error ?? "WCL OAuth 失败");
  return data.access_token;
}

/** WCL GraphQL 请求失败（携带 HTTP 状态码，调用方据此区分 429 配额错误）。 */
export class WclGqlError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`WCL GraphQL ${status}`);
    this.name = "WclGqlError";
    this.status = status;
  }
}

export interface GqlResult<T> {
  data: T;
  /** x-ratelimit-remaining（点数，随返回数据量递减）；无法解析时为 null。 */
  ratelimitRemaining: number | null;
}

export async function gqlQuery<T>(
  region: "www" | "cn",
  token: string,
  query: string,
  variables: Record<string, unknown>,
  fetchFn?: typeof fetch,
): Promise<GqlResult<T>> {
  const host = region === "cn" ? "cn.warcraftlogs.com" : "www.warcraftlogs.com";
  const res = await (fetchFn ?? fetch)(`https://${host}/api/v2/client`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": WCL_USER_AGENT,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new WclGqlError(res.status);
  const remainingRaw = res.headers.get("x-ratelimit-remaining");
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0].message);
  if (!body.data) throw new Error("WCL 响应无数据");
  return {
    data: body.data,
    ratelimitRemaining: remainingRaw != null ? Number(remainingRaw) : null,
  };
}

interface RealFight {
  id: number;
  name: string;
  difficulty?: number;
  keystoneLevel?: number | null;
  keystoneAffixes?: number[] | null;
  kill?: boolean;
  fightPercentage?: number;
  startTime?: number;
  endTime?: number;
  friendlyPlayers?: number[] | null;
  friendlySpecs?: string[] | null;
}

interface RealActor {
  id?: number | null;
  name?: string | null;
  subType?: string | null;
  type?: string | null;
}

const FIGHTS_QUERY = `
query ReportFights($code: String!) {
  reportData {
    report(code: $code) {
      title
      owner { name }
      masterData { actors(type: "Player") { id name subType type } }
      fights(killType: Kills) {
        id
        name
        difficulty
        keystoneLevel
        keystoneAffixes
        kill
        startTime
        endTime
        friendlyPlayers
        friendlySpecs
      }
    }
  }
}`;

async function fetchRealMeta(code: string, region: "www" | "cn"): Promise<WclReportMeta> {
  const token = await getAccessToken(region);
  const { data } = await gqlQuery<{
    reportData?: {
      report?: {
        title: string;
        owner?: { name?: string | null } | null;
        masterData?: { actors?: RealActor[] | null } | null;
        fights: RealFight[];
      };
    };
  }>(region, token, FIGHTS_QUERY, { code });
  const report = data.reportData?.report;
  if (!report) throw new Error("报告不存在或已过期");
  const fights = report.fights ?? [];
  // 玩家列表只看大秘境战斗（排除混入的团本战斗，避免团本队员混进复盘对象列表）
  const mythicFightsForPlayers = fights.filter((f) => f.keystoneLevel != null);
  const { players, uploaderName } = buildPlayers(
    report.masterData?.actors ?? [],
    mythicFightsForPlayers.map((f) => ({
      id: f.id,
      friendlyPlayers: f.friendlyPlayers,
      friendlySpecs: f.friendlySpecs,
    })),
    report.owner?.name,
  );
  return {
    code,
    title: report.title,
    players,
    uploaderName,
    fights: fights.map((f) => ({
      id: f.id,
      name: f.name,
      difficulty: f.difficulty ?? 0,
      keystoneLevel: f.keystoneLevel ?? null,
      affixes: (f.keystoneAffixes ?? []).map(String),
      success: f.kill ?? false,
      durationSec: f.startTime && f.endTime ? Math.round((f.endTime - f.startTime) / 1000) : 0,
      startTime: f.startTime ?? 0,
      endTime: f.endTime ?? f.startTime ?? 0,
      playerName: "（从 WCL 玩家列表选择）",
      playerClass: "Unknown",
      playerSpec: "Unknown",
      friendlyPlayers: f.friendlyPlayers ?? null,
    })),
  };
}

// ---------- mock ----------

/**
 * mock：根据链接 code 稳定合成元数据。
 *  - code 含 "raid"   → 团本链接（1 场，keystoneLevel 为 null）
 *  - code 含 "empty"  → 无任何战斗的报告（用于验证 NO_MYTHIC_FIGHT 文案）
 *  - 其余             → 2 场大秘境
 */
function fetchMockMeta(code: string): WclReportMeta {
  const isRaid = /raid/i.test(code);
  const isEmpty = /empty/i.test(code);
  const players = mockPlayers();
  const uploaderName = players.find((p) => p.isUploader)?.name;
  const fights: WclFight[] = isEmpty
    ? []
    : isRaid
    ? [
        {
          id: 1,
          name: "Liberation of Undermine",
          difficulty: 4,
          keystoneLevel: null,
          affixes: [],
          success: true,
          durationSec: 412,
          startTime: 60_000,
          endTime: 472_000,
          playerName: "DemoPlayer",
          playerClass: "Mage",
          playerSpec: "Fire",
        },
      ]
    : [
        {
          id: 7,
          name: "Mists of Tirna Scithe",
          difficulty: 8,
          keystoneLevel: 15,
          affixes: ["10", "124", "134"],
          success: true,
          durationSec: 1650,
          startTime: 60_000,
          endTime: 1_710_000,
          playerName: "DemoPlayer",
          playerClass: "Mage",
          playerSpec: "Fire",
        },
        {
          id: 9,
          name: "Grim Batol",
          difficulty: 8,
          keystoneLevel: 12,
          affixes: ["10", "124", "134"],
          success: false,
          durationSec: 1830,
          startTime: 1_800_000,
          endTime: 3_630_000,
          playerName: "DemoPlayer",
          playerClass: "Mage",
          playerSpec: "Fire",
        },
      ];
  return { code, title: `WCL 报告 ${code}（mock 数据）`, fights, players, uploaderName, isMock: true };
}

// ---------- 统一入口 ----------

// FR-1 验收文案（用户引导式）：保持 WclErrorCode 语义不变。
const MSG_INVALID_LINK = "链接无效或报告已过期，请检查后重新粘贴，或上传日志文件";
const MSG_NOT_MYTHIC = "第一版仅支持大秘境分析，请重新粘贴大秘境 log 链接，或上传战斗日志文件";
const MSG_NO_MYTHIC_FIGHT = "该报告中没有大秘境战斗，请更换链接或上传日志文件";
const MSG_FETCH_FAILED = "WCL 数据获取失败（网络或平台故障），请稍后重试或上传日志文件";

/**
 * 按链接 fight 提示为大秘境场次打 selected 标记（不丢失任何场次）：
 *  - fight=N  命中该 id 才打 selected；找不到该 id 则回退为无预选（保留全部场次）
 *  - fight=last 选中最后一场大秘境
 */
function applyFightHint(fights: WclFight[], hint?: WclFightHint): WclFight[] {
  if (hint === undefined) return fights;
  if (hint === "last") {
    // WCL 场次 id 随战斗开始顺序递增，最大 id 即时间上最后一场大秘境。
    // 用 max(id) 而非"列表最后一项"更稳健：不依赖接口返回排序（与 WCL 语义一致）。
    const lastId = fights.reduce((max, f) => Math.max(max, f.id), -Infinity);
    return fights.map((f) => ({ ...f, selected: f.id === lastId }));
  }
  const hit = fights.some((f) => f.id === hint);
  return hit ? fights.map((f) => ({ ...f, selected: f.id === hint })) : fights;
}

export async function getWclReportMeta(url: string): Promise<WclResult> {
  const parsed = parseWclUrl(url);
  if (!parsed.ok || !parsed.code) {
    return { ok: false, code: "INVALID_LINK", message: MSG_INVALID_LINK };
  }

  // 生产 fail-fast：缺 WCL 密钥直接抛错，禁止静默回退 mock 元数据（M-2）
  requireProductionEnv("WCL_CLIENT_ID", "WCL_CLIENT_SECRET");
  const useReal = Boolean(envConfig.wclClientId && envConfig.wclClientSecret);
  try {
    const meta = useReal
      ? await fetchRealMeta(parsed.code, parsed.region ?? "www")
      : fetchMockMeta(parsed.code);

    const mythicFights = meta.fights.filter((f) => f.keystoneLevel !== null);
    if (mythicFights.length === 0) {
      return {
        ok: false,
        code: meta.fights.length > 0 ? "NOT_MYTHIC" : "NO_MYTHIC_FIGHT",
        message: meta.fights.length > 0 ? MSG_NOT_MYTHIC : MSG_NO_MYTHIC_FIGHT,
      };
    }
    return { ok: true, meta: { ...meta, fights: applyFightHint(mythicFights, parsed.fight) } };
  } catch (err) {
    if (err instanceof Error && /不存在|过期|invalid|not found/i.test(err.message)) {
      return { ok: false, code: "INVALID_LINK", message: MSG_INVALID_LINK };
    }
    return { ok: false, code: "FETCH_FAILED", message: MSG_FETCH_FAILED };
  }
}

/** FR-3 对比基准（轻量）：返回该报告的战斗列表摘要，供"与顶尖玩家对比"章节引用。 */
export async function getCompareBaseline(url: string): Promise<WclResult> {
  const r = await getWclReportMeta(url);
  if (!r.ok) return r;
  return {
    ok: true,
    meta: {
      ...r.meta,
      title: r.meta.title + "（对比基准）",
    },
  };
}
