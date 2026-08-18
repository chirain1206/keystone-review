import type {
  KbDocument,
  KbHit,
  KbSearchFilters,
  KbSearchQuery,
} from "@/lib/kb/types";

/**
 * 知识库存储接口（T14）。
 * 实现：
 *  - SupabaseKbStore：pgvector 余弦检索（迁移 0003 的 match_kb_documents）
 *  - FileKbStore：本地 JSON + 关键词匹配（开发/mock，无外部依赖）
 * 补丁过滤约定（FR-11）：filters.patch = 活跃补丁；meta.patch = 'general' 始终命中；
 * meta.dungeon = '*' 全副本通用始终命中。旧补丁内容不注入。
 */
export interface KbStore {
  search(query: KbSearchQuery, filters: KbSearchFilters, topK: number): Promise<KbHit[]>;
  /** 按 source_hash 幂等 upsert；返回写入条数。 */
  upsert(docs: KbDocument[]): Promise<number>;
  /** 库中最新非 general 补丁（ACTIVE_PATCH 未配置时的缺省活跃补丁）。 */
  getActivePatch(): Promise<string | null>;
  count(): Promise<number>;
}
