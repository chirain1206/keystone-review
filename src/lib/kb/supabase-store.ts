import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { envConfig } from "@/lib/env";
import type { KbStore } from "@/lib/kb/store";
import type { KbDocument, KbHit, KbListFilter, KbListRow, KbMeta, KbSearchFilters, KbSearchQuery } from "@/lib/kb/types";
import { KB_TOP_K_MAX } from "@/lib/kb/types";

/**
 * 生产知识库存储（T14）：Supabase pgvector（迁移 0003）。
 * 服务端经 service role 连接；kb_documents 无 RLS 且已回收 anon/authenticated
 * 权限 —— 仅服务端私有密钥可访问（见 0003 迁移注释）。
 * 检索走 match_kb_documents RPC（余弦相似度 + meta 过滤 + top-k）。
 */
function client(): SupabaseClient {
  return createClient(envConfig.supabaseUrl, envConfig.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export class SupabaseKbStore implements KbStore {
  async search(
    query: KbSearchQuery,
    filters: KbSearchFilters,
    topK: number,
  ): Promise<KbHit[]> {
    const { data, error } = await client().rpc("match_kb_documents", {
      query_embedding: query.vector,
      match_class: filters.class ?? null,
      match_spec: filters.spec ?? null,
      match_dungeon: filters.dungeon ?? null,
      match_patch: filters.patch ?? null,
      match_status: filters.status ?? "active",
      match_count: Math.min(Math.max(topK, 1), KB_TOP_K_MAX),
    });
    if (error) throw new Error(`知识库检索失败：${error.message}`);
    return ((data ?? []) as { id: string; chunk_text: string; meta: KbDocument["meta"]; similarity: number }[]).map(
      (r) => ({
        id: r.id,
        chunkText: r.chunk_text,
        meta: r.meta,
        score: r.similarity,
      }),
    );
  }

  async upsert(docs: KbDocument[]): Promise<number> {
    if (docs.length === 0) return 0;
    const rows = docs.map((d) => ({
      chunk_text: d.chunkText,
      embedding: d.embedding,
      meta: d.meta as unknown as Record<string, unknown>,
      source_hash: d.sourceHash,
    }));
    const { error } = await client()
      .from("kb_documents")
      .upsert(rows, { onConflict: "source_hash" });
    if (error) throw new Error(`知识库写入失败：${error.message}`);
    return docs.length;
  }

  async getActivePatch(): Promise<string | null> {
    const { data, error } = await client()
      .from("kb_documents")
      .select("meta")
      .not("meta->>patch", "eq", "general")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(`读取活跃补丁失败：${error.message}`);
    const patches = (data ?? [])
      .map((r) => (r.meta as { patch?: string }).patch)
      .filter((p): p is string => Boolean(p));
    if (patches.length === 0) return null;
    const numeric = patches.filter((p) => /^[\d.]+$/.test(p));
    const pool = numeric.length ? numeric : patches;
    return pool.sort((a, b) => cmpPatch(b, a))[0];
  }

  async count(): Promise<number> {
    const { count } = await client()
      .from("kb_documents")
      .select("*", { count: "exact", head: true });
    return count ?? 0;
  }

  async list(filter: KbListFilter = {}): Promise<KbListRow[]> {
    let q = client().from("kb_documents").select("id, chunk_text, meta");
    if (filter.patch) q = q.eq("meta->>patch", filter.patch);
    if (filter.status) q = q.eq("meta->>status", filter.status);
    if (filter.origin) q = q.eq("meta->>origin", filter.origin);
    if (filter.class) q = q.eq("meta->>class", filter.class);
    if (filter.idPrefix) q = q.ilike("id::text", `${filter.idPrefix}%`);
    if (filter.limit && filter.limit > 0) q = q.limit(filter.limit);
    q = q.order("id", { ascending: true });
    const { data, error } = await q;
    if (error) throw new Error(`知识库列表查询失败：${error.message}`);
    return ((data ?? []) as { id: string; chunk_text: string; meta: KbMeta }[]).map((r) => ({
      id: r.id,
      chunkText: r.chunk_text,
      meta: r.meta,
    }));
  }

  async updateStatus(ids: string[], status: KbMeta["status"]): Promise<number> {
    if (ids.length === 0) return 0;
    // jsonb 字段无法在 PostgREST 中做部分合并，故先取回 meta 合并 status 后逐条写回。
    // 运维路径低并发、低批量，N 次往返可接受；避免引入 RPC/迁移扩大改动面。
    const { data, error } = await client()
      .from("kb_documents")
      .select("id, meta")
      .in("id", ids);
    if (error) throw new Error(`知识库状态查询失败：${error.message}`);
    let changed = 0;
    for (const row of (data ?? []) as { id: string; meta: KbMeta }[]) {
      const current = row.meta ?? ({} as KbMeta);
      if (current.status === status) continue; // 已是目标状态 → 跳过
      const meta = { ...current, status } as unknown as Record<string, unknown>;
      const { error: ue } = await client()
        .from("kb_documents")
        .update({ meta, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (ue) throw new Error(`知识库状态更新失败：${ue.message}`);
      changed++;
    }
    return changed;
  }

  async deleteByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { error } = await client().from("kb_documents").delete().in("id", ids);
    if (error) throw new Error(`知识库删除失败：${error.message}`);
    return ids.length;
  }
}

/** 补丁号比较（与 file-store 同口径）。 */
function cmpPatch(a: string, b: string): number {
  const as = a.split(".").map(Number);
  const bs = b.split(".").map(Number);
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i] ?? 0;
    const y = bs[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}
