import type {
  KbDocument,
  KbHit,
  KbListFilter,
  KbListRow,
  KbMeta,
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
  /**
   * 运维列表（T20）：按 idPrefix/patch/status/origin/class 过滤，limit 截断
   * （0/undefined = 不限）。返回行不含 embedding（避免搬运大向量）。
   */
  list(filter?: KbListFilter): Promise<KbListRow[]>;
  /** 运维下线/激活（T20）：按 id 批量更新 meta.status，返回实际变更条数（已是目标状态则跳过）。 */
  updateStatus(ids: string[], status: KbMeta["status"]): Promise<number>;
  /** 运维物理删除（T20）：按 id 批量删除，返回实际删除条数。 */
  deleteByIds(ids: string[]): Promise<number>;
}
