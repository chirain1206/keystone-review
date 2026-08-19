/**
 * 知识库领域类型（T14，FR-11）。
 * kb_documents 表的形状：片段文本 + 元数据 + 幂等哈希。
 */

export interface KbMeta {
  /** 职业原名（Mage / Warrior / Hunter…） */
  class: string;
  /** 专精原名（Fire / Protection / Beast Mastery…）；"*" = 该职业全专精通用 */
  spec: string;
  /** 副本名（游戏原名）；"*" = 全副本通用 */
  dungeon: string;
  /** 内容版本补丁（如 "12.1"）；"general" = 跨版本通用 */
  patch: string;
  /** 内容类型：intent_pattern / burst_planning / resource_management / dungeon_mechanic / patch_change */
  type: string;
  /** 出处链接（必填，报告引用时标注"参考社区攻略"） */
  source_url: string;
  /** 来源：curated=攻略整理 / inferred=log 推断 / community=社区反馈（由入库目录决定） */
  origin: "curated" | "inferred" | "community";
  /** 状态：active=生效（可注入）/ candidate=候选（绝不注入正式分析）/ deprecated=弃用 */
  status: "active" | "candidate" | "deprecated";
  /** 提交人邮箱（专家社区提交接口写入）。 */
  submitted_by?: string;
  /** 提交时间 ISO（专家社区提交接口写入）。 */
  submitted_at?: string;
  /** 审核人邮箱（专家审核接口写入）。 */
  reviewed_by?: string;
  /** 审核时间 ISO（专家审核接口写入）。 */
  reviewed_at?: string;
  /** 疑似重复的已生效条目（专家提交时向量查重得出，仅存于候选 meta，供审核页展示）。 */
  duplicates?: KbDuplicateHint[];
}

/** 疑似重复条目提示（专家提交查重结果）。 */
export interface KbDuplicateHint {
  id: string;
  /** 标题（片段首行）。 */
  title: string;
  /** 内容摘要（截断）。 */
  summary: string;
  /** 相似度 0–1（Supabase 余弦；mock 为关键词命中分，见 kb/community.ts 查重）。 */
  score: number;
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
  /**
   * 状态过滤：默认 "active"（候选/弃用条目绝不注入正式分析）；
   * 显式传入其他值仅供管理/测试查询。
   */
  status?: "active" | "candidate" | "deprecated";
}

export interface KbSearchQuery {
  /** 查询原文（mock 关键词检索用） */
  text: string;
  /** 查询向量（Supabase pgvector 用） */
  vector: number[];
}

/** 知识库管理列表过滤条件（运维 CLI，T20）。 */
export interface KbListFilter {
  /** 按 id 前缀匹配（大小写不敏感；uuid 通常小写）。 */
  idPrefix?: string;
  /** 内容版本补丁（如 "12.1"）。 */
  patch?: string;
  status?: KbMeta["status"];
  origin?: KbMeta["origin"];
  class?: string;
  /** 返回上限；0/undefined = 不限。 */
  limit?: number;
}

/** 知识库管理列表行（运维 CLI 展示用；不含 embedding，避免搬运大向量）。 */
export interface KbListRow {
  id: string;
  chunkText: string;
  meta: KbMeta;
}

export const KB_TOP_K_MAX = 5;
