import type {
  FeedbackCreateInput,
  FeedbackListFilter,
  FeedbackRow,
  FeedbackStatus,
} from "@/lib/feedback/types";

/**
 * 反馈存储接口（FEEDBACK）。
 *  - SupabaseFeedbackStore：service role 直连 feedback 表（迁移 0004）
 *  - FileFeedbackStore：本地 JSON（开发/mock，无外部依赖）
 */
export interface FeedbackStore {
  create(input: FeedbackCreateInput): Promise<FeedbackRow>;
  list(filter?: FeedbackListFilter): Promise<FeedbackRow[]>;
  get(id: string): Promise<FeedbackRow | null>;
  /** 更新状态；返回是否实际变更（行存在且状态不同）。 */
  updateStatus(id: string, status: FeedbackStatus): Promise<boolean>;
}
