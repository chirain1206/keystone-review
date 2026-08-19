import { gqlQuery } from "@/lib/wcl/adapter";

/**
 * WCL v2 能力 id → 名称批量映射。
 *
 * 实测结论（translate:false 与 translate:true 一致）：事件只回传 `abilityGameID` /
 * `extraAbilityGameID`，不含 `ability.name`；translate:true 也不会补充名称。
 * 因此名称必须另用 worldData 能力查询解析——实测 `gameData` 是顶层查询字段：
 *   gameData { ability(id: Int) { id name } }
 * 批量时用 GraphQL 别名一次请求查多个 id（a0/a1/…），避免逐条发请求。
 *
 * 名称结果进程内缓存（能力名称长期稳定），跨报告复用，不重复消耗配额。
 */

const ABILITY_NAME_CACHE = new Map<number, { name: string; at: number }>();
/** 能力名称基本不随版本变化，缓存 24 小时。 */
const ABILITY_NAME_TTL_MS = 24 * 60 * 60 * 1000;
/** 单次查询最多 200 个能力（别名展开，控制请求体大小与配额）。 */
const ABILITY_BATCH_SIZE = 200;

export interface AbilityNameDeps {
  fetchFn?: typeof fetch;
}

function buildAbilityQuery(ids: number[]): string {
  const fields = ids.map((id, i) => `a${i}: ability(id: ${id}) { id name }`).join(" ");
  return `query AbilityNames { gameData { ${fields} } }`;
}

async function queryAbilityBatch(
  region: "www" | "cn",
  token: string,
  ids: number[],
  fetchFn?: typeof fetch,
): Promise<Map<number, string>> {
  const { data } = await gqlQuery<{
    gameData?: Record<string, { id?: number | null; name?: string | null } | null>;
  }>(region, token, buildAbilityQuery(ids), {}, fetchFn);
  const out = new Map<number, string>();
  for (const v of Object.values(data.gameData ?? {})) {
    if (v && typeof v.id === "number" && typeof v.name === "string") out.set(v.id, v.name);
  }
  return out;
}

/**
 * 批量解析能力 id → 名称（先查缓存，未命中部分分批发查询）。
 * 单批失败不阻塞整体（缺失的 id 保持无名），调用方按 best-effort 处理。
 */
export async function resolveAbilityNames(
  region: "www" | "cn",
  token: string,
  ids: Iterable<number>,
  deps: AbilityNameDeps = {},
): Promise<Map<number, string>> {
  const unique = [...new Set(ids)].filter((id) => id > 0);
  const result = new Map<number, string>();
  const now = Date.now();
  const missing: number[] = [];
  for (const id of unique) {
    const hit = ABILITY_NAME_CACHE.get(id);
    if (hit && now - hit.at < ABILITY_NAME_TTL_MS) {
      result.set(id, hit.name);
    } else {
      missing.push(id);
    }
  }
  for (let i = 0; i < missing.length; i += ABILITY_BATCH_SIZE) {
    const chunk = missing.slice(i, i + ABILITY_BATCH_SIZE);
    try {
      const names = await queryAbilityBatch(region, token, chunk, deps.fetchFn);
      for (const [id, name] of names) {
        ABILITY_NAME_CACHE.set(id, { name, at: Date.now() });
        result.set(id, name);
      }
    } catch {
      // 忽略单批失败，其余批次继续
    }
  }
  return result;
}

/** 测试用：清空能力名称缓存。 */
export function clearAbilityNameCache(): void {
  ABILITY_NAME_CACHE.clear();
}
