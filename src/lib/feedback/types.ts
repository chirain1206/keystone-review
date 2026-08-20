/**
 * 用户反馈收集领域类型（FEEDBACK）。
 * public.feedback 表的形状：分类 + 内容 + 可选邮箱/来源页面 + 处理状态。
 */

export const FEEDBACK_CATEGORIES = ["bug", "suggestion", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_STATUSES = ["new", "read", "resolved"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** 内容长度上限（字）：与前端 textarea 校验同口径。 */
export const FEEDBACK_CONTENT_MAX = 2000;
/** 来源页面路径长度上限。 */
export const FEEDBACK_PAGE_URL_MAX = 500;

export interface FeedbackCreateInput {
  /** 登录用户 id（可空：访客提交无关联）。 */
  userId: string | null;
  /** 访客自填邮箱（可空；登录用户无需填写）。 */
  email: string | null;
  category: FeedbackCategory;
  content: string;
  /** 前端附上的当前页面路径（可空）。 */
  pageUrl: string | null;
}

export interface FeedbackRow {
  id: string;
  userId: string | null;
  email: string | null;
  category: FeedbackCategory;
  content: string;
  pageUrl: string | null;
  status: FeedbackStatus;
  /** epoch 毫秒。 */
  createdAt: number;
}

export interface FeedbackListFilter {
  status?: FeedbackStatus;
  /** 返回上限；0/undefined = 默认（100）。 */
  limit?: number;
}
