import { envConfig, requireProductionEnv } from "@/lib/env";

/**
 * WCL v2 API 适配器（T8，FR-1/FR-3）。
 *  - 有 WCL_CLIENT_ID/SECRET → 真实 OAuth client_credentials + GraphQL 查询
 *    （www 与 cn 域各自对应官方 API 端点；只做轻量元数据查询）
 *  - 无密钥（开发/mock）→ 根据链接结构合成元数据，流程可离线自测
 * 失败分级（FR-1 验收）：
 *   INVALID_LINK   不是 WCL 链接 → "不是 WCL 链接，可以上传日志文件代替"
 *   NOT_MYTHIC     链接本身指向团本/无法判定 → "仅支持大秘境"
 *   FETCH_FAILED   API 网络/配额失败 → "获取失败，请稍后重试或上传日志文件"
 */

export interface WclFight {
  id: number;
  name: string; // 副本/首领名（游戏原名）
  difficulty: number;
  keystoneLevel: number | null; // 大秘境层数；团本为 null
  affixes: string[];
  success: boolean;
  durationSec: number;
  playerName: string; // 报告主角（best-effort）
  playerClass: string;
  playerSpec: string;
}

export interface WclReportMeta {
  code: string;
  title: string;
  fights: WclFight[];
}

export type WclErrorCode = "INVALID_LINK" | "NOT_MYTHIC" | "FETCH_FAILED" | "NO_MYTHIC_FIGHT";

export type WclResult =
  | { ok: true; meta: WclReportMeta }
  | { ok: false; code: WclErrorCode; message: string };

const REPORT_URL_RE =
  /^https:\/\/(?:(?:www|cn)\.)?warcraftlogs\.com\/reports\/([A-Za-z0-9]+)\/?(?:#[\w=-]+)?(?:\?.*)?$/i;

export function parseWclUrl(url: string): { ok: boolean; code?: string; region?: "www" | "cn" } {
  const m = REPORT_URL_RE.exec(url.trim());
  if (!m) return { ok: false };
  return {
    ok: true,
    code: m[1],
    region: /cn\.warcraftlogs\.com/i.test(url) ? "cn" : "www",
  };
}

// ---------- 真实 API ----------

interface OAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  error?: string;
}

async function getAccessToken(region: "www" | "cn"): Promise<string> {
  const host = region === "cn" ? "cn.warcraftlogs.com" : "www.warcraftlogs.com";
  const res = await fetch(`https://${host}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`WCL OAuth ${res.status}`);
  const data = (await res.json()) as OAuthTokenResponse;
  if (!data.access_token) throw new Error(data.error ?? "WCL OAuth 失败");
  return data.access_token;
}

async function gqlQuery<T>(
  region: "www" | "cn",
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const host = region === "cn" ? "cn.warcraftlogs.com" : "www.warcraftlogs.com";
  const res = await fetch(`https://${host}/api/v2/client`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`WCL GraphQL ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0].message);
  if (!body.data) throw new Error("WCL 响应无数据");
  return body.data;
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
}

const FIGHTS_QUERY = `
query ReportFights($code: String!) {
  reportData {
    report(code: $code) {
      title
      fights(killType: Kills) {
        id
        name
        difficulty
        keystoneLevel
        keystoneAffixes
        kill
        startTime
        endTime
      }
    }
  }
}`;

async function fetchRealMeta(code: string, region: "www" | "cn"): Promise<WclReportMeta> {
  const token = await getAccessToken(region);
  const data = await gqlQuery<{
    reportData?: { report?: { title: string; fights: RealFight[] } };
  }>(region, token, FIGHTS_QUERY, { code });
  const report = data.reportData?.report;
  if (!report) throw new Error("报告不存在或已过期");
  return {
    code,
    title: report.title,
    fights: (report.fights ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      difficulty: f.difficulty ?? 0,
      keystoneLevel: f.keystoneLevel ?? null,
      affixes: (f.keystoneAffixes ?? []).map(String),
      success: f.kill ?? false,
      durationSec: f.startTime && f.endTime ? Math.round((f.endTime - f.startTime) / 1000) : 0,
      playerName: "（从 WCL 玩家列表选择）",
      playerClass: "Unknown",
      playerSpec: "Unknown",
    })),
  };
}

// ---------- mock ----------

/** mock：根据链接 code 稳定合成一场大秘境（code 含 "raid" 时模拟团本链接）。 */
function fetchMockMeta(code: string): WclReportMeta {
  const isRaid = /raid/i.test(code);
  const fights: WclFight[] = isRaid
    ? [
        {
          id: 1,
          name: "Liberation of Undermine",
          difficulty: 4,
          keystoneLevel: null,
          affixes: [],
          success: true,
          durationSec: 412,
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
          playerName: "DemoPlayer",
          playerClass: "Mage",
          playerSpec: "Fire",
        },
      ];
  return { code, title: `WCL 报告 ${code}（mock 数据）`, fights };
}

// ---------- 统一入口 ----------

export async function getWclReportMeta(url: string): Promise<WclResult> {
  const parsed = parseWclUrl(url);
  if (!parsed.ok || !parsed.code) {
    return { ok: false, code: "INVALID_LINK", message: "不是 WCL 链接，请粘贴 warcraftlogs.com 报告链接，或改用文件上传" };
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
        message:
          meta.fights.length > 0
            ? "该链接是团本记录，第一版仅支持大秘境分析，请上传大秘境战斗日志文件"
            : "该报告中没有可分析的大秘境战斗",
      };
    }
    return { ok: true, meta: { ...meta, fights: mythicFights } };
  } catch (err) {
    if (err instanceof Error && /不存在|过期|invalid|not found/i.test(err.message)) {
      return { ok: false, code: "INVALID_LINK", message: "链接无效或报告已过期，请检查后重试" };
    }
    return {
      ok: false,
      code: "FETCH_FAILED",
      message: "WCL 数据获取失败（网络或平台故障），请稍后重试或上传日志文件",
    };
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
