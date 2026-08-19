import { gqlQuery } from "@/lib/wcl/adapter";

/**
 * WCL v2 NPC gameID → 名称批量映射（自动对比推荐的路由签名用）。
 *
 * ReportDungeonPull.enemyNPCs 只回传 { id, gameID }（无 name），名称必须另用
 * gameData.npc(id) 解析——与 ability-names.ts 的 gameData.ability(id) 同一套模式。
 * 批量时用 GraphQL 别名一次请求查多个 id（n0/n1/…），避免逐条发请求。
 *
 * 名称结果进程内缓存（NPC 名称长期稳定），跨报告复用，不重复消耗配额。
 */

const NPC_NAME_CACHE = new Map<number, { name: string; at: number }>();
/** NPC 名称基本不随版本变化，缓存 24 小时。 */
const NPC_NAME_TTL_MS = 24 * 60 * 60 * 1000;
/** 单次查询最多 200 个 NPC（别名展开，控制请求体大小与配额）。 */
const NPC_BATCH_SIZE = 200;

export interface NpcNameDeps {
  fetchFn?: typeof fetch;
}

function buildNpcQuery(ids: number[]): string {
  const fields = ids.map((id, i) => `n${i}: npc(id: ${id}) { id name }`).join(" ");
  return `query NpcNames { gameData { ${fields} } }`;
}

async function queryNpcBatch(
  region: "www" | "cn",
  token: string,
  ids: number[],
  fetchFn?: typeof fetch,
): Promise<Map<number, string>> {
  const { data } = await gqlQuery<{
    gameData?: Record<string, { id?: number | null; name?: string | null } | null>;
  }>(region, token, buildNpcQuery(ids), {}, fetchFn);
  const out = new Map<number, string>();
  for (const v of Object.values(data.gameData ?? {})) {
    if (v && typeof v.id === "number" && typeof v.name === "string") out.set(v.id, v.name);
  }
  return out;
}

/**
 * 批量解析 NPC gameID → 名称（先查缓存，未命中部分分批发查询）。
 * 单批失败不阻塞整体（缺失的 id 保持无名，调用方按 best-effort 处理）。
 */
export async function resolveNpcNames(
  region: "www" | "cn",
  token: string,
  ids: Iterable<number>,
  deps: NpcNameDeps = {},
): Promise<Map<number, string>> {
  const unique = [...new Set(ids)].filter((id) => id > 0);
  const result = new Map<number, string>();
  const now = Date.now();
  const missing: number[] = [];
  for (const id of unique) {
    const hit = NPC_NAME_CACHE.get(id);
    if (hit && now - hit.at < NPC_NAME_TTL_MS) {
      result.set(id, hit.name);
    } else {
      missing.push(id);
    }
  }
  for (let i = 0; i < missing.length; i += NPC_BATCH_SIZE) {
    const chunk = missing.slice(i, i + NPC_BATCH_SIZE);
    try {
      const names = await queryNpcBatch(region, token, chunk, deps.fetchFn);
      for (const [id, name] of names) {
        NPC_NAME_CACHE.set(id, { name, at: Date.now() });
        result.set(id, name);
      }
    } catch {
      // 忽略单批失败，其余批次继续
    }
  }
  return result;
}

/** 测试用：清空 NPC 名称缓存。 */
export function clearNpcNameCache(): void {
  NPC_NAME_CACHE.clear();
}
