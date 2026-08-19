import { gqlQuery } from "@/lib/wcl/adapter";

/**
 * 副本英文名 → WCL M+ encounter id 解析（自动对比推荐候选搜索用）。
 *
 * 真实探测核实（2026-08，live WCL v2 API）：
 *  - `worldData.zones(name:)` 无效（zones 只接受 expansion_id，不接受 name）——旧实现误用。
 *  - 正确路径：`worldData.expansions`（最新在前，Midnight id=7）→ `expansion(id:7).zones`。
 *  - 大秘境按"赛季 zone"组织：当前 live 赛季为 zone id=55 "Mythic+ Season 2"，其下每个副本
 *    是一个 encounter（排行榜查询 worldData.encounter(id).characterRankings 挂在副本 encounter 上）。
 *  - 注意 "Mythic+ Season 2 (PTR)"（id=56）含同名但不同 id 的 PTR encounter，须排除。
 *
 * 因此**首选静态映射表**（一次性查好，零配额），动态解析（expansion(7).zones）仅作兜底。
 */

export interface DungeonEncounter {
  encounterId: number;
  encounterName: string;
}

export interface DungeonZoneDeps {
  fetchFn?: typeof fetch;
}

/** 归一化：小写 + 去掉所有非字母数字字符（容忍 "Kings' Rest" vs "King's Rest" 撇号差异）。 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Midnight（至暗之夜）expansion id（真实探测核实）。 */
const MIDNIGHT_EXPANSION_ID = 7;
/** 当前 live 赛季 zone 名（真实探测核实）。 */
const LIVE_SEASON_ZONE = "Mythic+ Season 2";

/**
 * 12.1 赛季（Mythic+ Season 2，zone id=55）8 副本 → encounter id 静态映射。
 * 来源：真实探测 `worldData { expansion(id: 7) { zones { name encounters { id name } } } }`
 * 中 zone "Mythic+ Season 2"（id=55）的 encounters（2026-08）。
 */
const SEASON_2_ENCOUNTERS: Record<string, number> = {
  [normalizeName("Altar of Fangs")]: 12993,
  [normalizeName("Den of Nalorakk")]: 12825,
  [normalizeName("Kings' Rest")]: 61762, // WCL 拼写为 "Kings' Rest"（撇号在 s 后）
  [normalizeName("Murder Row")]: 12813,
  [normalizeName("Ruby Life Pools")]: 112521,
  [normalizeName("Temple of Sethraliss")]: 61877,
  [normalizeName("The Blinding Vale")]: 12859,
  [normalizeName("Voidscar Arena")]: 12923,
};

const ZONE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 整份 expansion zones 列表缓存（key 为 region）。 */
const ZONES_LIST_CACHE = new Map<string, { zones: ZoneRow[]; at: number }>();
/** 副本名（归一化）→ encounter 结果缓存（含负缓存）。 */
const ENCOUNTER_CACHE = new Map<string, { info: DungeonEncounter | null; at: number }>();

interface ZoneRow {
  name: string;
  encounters: { id: number; name: string }[];
}

const ZONES_QUERY = `
query ExpansionZones($expansionId: Int!) {
  worldData {
    expansion(id: $expansionId) {
      zones { name encounters { id name } }
    }
  }
}`;

/** 拉取并缓存 Midnight 的 zones（含 encounters）。失败抛错，由调用方降级。 */
async function fetchZones(
  region: "www" | "cn",
  token: string,
  deps: DungeonZoneDeps,
): Promise<ZoneRow[]> {
  const cached = ZONES_LIST_CACHE.get(region);
  if (cached && Date.now() - cached.at < ZONE_CACHE_TTL_MS) return cached.zones;

  const { data } = await gqlQuery<{
    worldData?: { expansion?: { zones?: ZoneRow[] | null } | null } | null;
  }>(region, token, ZONES_QUERY, { expansionId: MIDNIGHT_EXPANSION_ID }, deps.fetchFn);
  const zones = (data.worldData?.expansion?.zones ?? []).filter(
    (z) => z && typeof z.name === "string",
  );
  ZONES_LIST_CACHE.set(region, { zones, at: Date.now() });
  return zones;
}

/**
 * 按副本英文名解析 M+ encounter id。
 *  1) 静态映射命中 → 直接返回（零配额）；
 *  2) 否则动态解析：expansion(7).zones → 找 live 赛季 zone（"Mythic+ Season 2"，排除 PTR/Beta）→
 *     按副本名匹配 encounter；匹配不到返回 null（调用方降级为无候选）。
 */
export async function resolveDungeonEncounter(
  region: "www" | "cn",
  token: string,
  dungeon: string,
  deps: DungeonZoneDeps = {},
): Promise<DungeonEncounter | null> {
  const key = normalizeName(dungeon);
  if (!key) return null;

  // 静态映射优先
  const staticId = SEASON_2_ENCOUNTERS[key];
  if (staticId !== undefined) {
    return { encounterId: staticId, encounterName: dungeon };
  }

  // 缓存
  const hit = ENCOUNTER_CACHE.get(key);
  if (hit && Date.now() - hit.at < ZONE_CACHE_TTL_MS) return hit.info;

  let info: DungeonEncounter | null = null;
  try {
    const zones = await fetchZones(region, token, deps);
    // 排除 PTR/Beta：仅取精确名为 live 赛季的 zone
    const zone = zones.find((z) => normalizeName(z.name) === normalizeName(LIVE_SEASON_ZONE));
    if (zone) {
      const encounter = (zone.encounters ?? []).find((e) => normalizeName(e.name) === key);
      if (encounter) {
        info = { encounterId: encounter.id, encounterName: encounter.name };
      }
    }
  } catch {
    info = null;
  }
  ENCOUNTER_CACHE.set(key, { info, at: Date.now() });
  return info;
}

/** 测试用：清空 zone 解析缓存。 */
export function clearDungeonZoneCache(): void {
  ZONES_LIST_CACHE.clear();
  ENCOUNTER_CACHE.clear();
}

/** 测试用：暴露静态映射表（供单测断言 12.1 赛季 8 副本全覆盖）。 */
export function season2EncounterIds(): Record<string, number> {
  return { ...SEASON_2_ENCOUNTERS };
}
