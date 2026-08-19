import { gqlQuery } from "@/lib/wcl/adapter";

/**
 * 副本英文名 → WCL zone id / encounter id 解析（自动对比推荐候选搜索用）。
 *
 * WCL v2 的 M+ 排行榜挂载在"副本 Zone 下的 encounter"上（Encounter.fightRankings），
 * 需要先由副本名解析出 zone id 与 encounter id。这里**动态按名解析**（而非硬编码 id）：
 * 一次性拉取 worldData.zones（所有 zone + 其 encounters），按副本名匹配，结果进程内缓存
 * （zone/encounter 结构长期稳定，缓存 24 小时），避免硬编码 id 随赛季轮换失效。
 *
 * 字段名已对照 WCL v2 schema 核实（github.com/math280h/go-wcl schema.graphql）：
 *  - worldData.zones(expansion_id: Int): [Zone]  （expansion_id 可省略 = 全扩展）
 *  - Zone { id, name, encounters: [Encounter] }
 *  - Encounter { id, name, journalID }
 */

export interface ZoneInfo {
  zoneId: number;
  /** M+ 排行所用的 encounter id（启发式选择，见 resolveDungeonZone）。 */
  encounterId: number | null;
  encounterName: string | null;
}

export interface DungeonZoneDeps {
  fetchFn?: typeof fetch;
}

const ZONE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 整份 zones 列表缓存（key 为 region）。 */
const ZONES_LIST_CACHE = new Map<string, { zones: ZoneRow[]; at: number }>();
/** 副本名（归一化）→ ZoneInfo 结果缓存。 */
const ZONE_INFO_CACHE = new Map<string, { info: ZoneInfo | null; at: number }>();

interface ZoneRow {
  id: number;
  name: string;
  encounters: { id: number; name: string }[];
}

/** 归一化副本名：小写 + 统一弯引号/撇号，容忍 WCL 命名差异。 */
function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ");
}

const ZONES_QUERY = `
query WorldZones {
  worldData {
    zones {
      id
      name
      encounters { id name }
    }
  }
}`;

/** 拉取并缓存全部 zones（含 encounters）。失败抛错，由调用方降级。 */
async function fetchZones(
  region: "www" | "cn",
  token: string,
  deps: DungeonZoneDeps,
): Promise<ZoneRow[]> {
  const cached = ZONES_LIST_CACHE.get(region);
  if (cached && Date.now() - cached.at < ZONE_CACHE_TTL_MS) return cached.zones;

  const { data } = await gqlQuery<{
    worldData?: { zones?: ZoneRow[] | null } | null;
  }>(region, token, ZONES_QUERY, {}, deps.fetchFn);
  const zones = (data.worldData?.zones ?? []).filter((z) => z && typeof z.id === "number");
  ZONES_LIST_CACHE.set(region, { zones, at: Date.now() });
  return zones;
}

/**
 * 按副本英文名解析 zone id 与 encounter id。
 * - 匹配 zone：normalizeName 相等；匹配不到返回 null（调用方降级为无候选）。
 * - 匹配 encounter：优先取与副本同名的 encounter（M+ 合成 encounter），否则取第一个；
 *   无 encounter 时 encounterId 为 null（仅阵容推荐、无路线排行来源）。
 */
export async function resolveDungeonZone(
  region: "www" | "cn",
  token: string,
  dungeon: string,
  deps: DungeonZoneDeps = {},
): Promise<ZoneInfo | null> {
  const key = normalizeName(dungeon);
  if (!key) return null;
  const hit = ZONE_INFO_CACHE.get(key);
  if (hit && Date.now() - hit.at < ZONE_CACHE_TTL_MS) return hit.info;

  let info: ZoneInfo | null = null;
  try {
    const zones = await fetchZones(region, token, deps);
    const zone = zones.find((z) => normalizeName(z.name) === key);
    if (zone) {
      const encounters = zone.encounters ?? [];
      const byName = encounters.find((e) => normalizeName(e.name) === key);
      const encounter = byName ?? encounters[0] ?? null;
      info = {
        zoneId: zone.id,
        encounterId: encounter?.id ?? null,
        encounterName: encounter?.name ?? null,
      };
    }
  } catch {
    info = null;
  }
  // 负缓存也写入（避免同一次会话内反复重试同一查不到的副本）
  ZONE_INFO_CACHE.set(key, { info, at: Date.now() });
  return info;
}

/** 测试用：清空 zone 解析缓存。 */
export function clearDungeonZoneCache(): void {
  ZONES_LIST_CACHE.clear();
  ZONE_INFO_CACHE.clear();
}
