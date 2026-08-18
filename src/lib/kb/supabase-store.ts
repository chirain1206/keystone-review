import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { envConfig } from "@/lib/env";
import type { KbStore } from "@/lib/kb/store";
import type { KbDocument, KbHit, KbSearchFilters, KbSearchQuery } from "@/lib/kb/types";
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
