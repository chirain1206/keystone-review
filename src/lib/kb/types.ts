/**
 * 知识库领域类型（T14，FR-11）。
 * kb_documents 表的形状：片段文本 + 元数据 + 幂等哈希。
 */

export interface KbMeta {
  /** 职业原名（Mage / Warrior / Hunter…） */
  class: string;
  /** 专精原名（Fire / Protection / Beast Mastery…） */
  spec: string;
  /** 副本名（游戏原名）；"*" = 全副本通用 */
  dungeon: string;
  /** 内容版本补丁（如 "12.1"）；"general" = 跨版本通用 */
  patch: string;
  /** 内容类型：intent_pattern / burst_planning / resource_management / dungeon_mechanic / patch_change */
  type: string;
  /** 出处链接（必填，报告引用时标注"参考社区攻略"） */
  source_url: string;
}

export interface KbDocument {
  id: string;
  chunkText: string;
  meta: KbMeta;
  sourceHash: string;
  /** bge-m3 1024 维向量（mock 模式为确定性伪向量） */
  embedding: number[];
}

export interface KbHit {
  id: string;
  chunkText: string;
  meta: KbMeta;
  /** 相似度 0–1（mock 关键词评分为加权命中分） */
  score: number;
}

export interface KbSearchFilters {
  class?: string;
  spec?: string;
  dungeon?: string;
  /** 活跃补丁；null = 不按补丁过滤（测试用） */
  patch?: string | null;
  type?: string;
}

export interface KbSearchQuery {
  /** 查询原文（mock 关键词检索用） */
  text: string;
  /** 查询向量（Supabase pgvector 用） */
  vector: number[];
}

export const KB_TOP_K_MAX = 5;
