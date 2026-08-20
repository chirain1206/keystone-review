import { z } from "zod";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CONTENT_MAX,
  FEEDBACK_PAGE_URL_MAX,
  type FeedbackStatus,
} from "@/lib/feedback/types";

/**
 * 反馈提交 body 校验（FEEDBACK）：与前端表单字段同口径。
 *  - category：bug / suggestion / other
 *  - content：1–2000 字（trim 后）
 *  - email：可选（访客自填），空串或合法邮箱；登录用户由服务端自动关联
 *  - page_url：可选，≤500 字（前端附上的当前页面路径）
 */
export const feedbackBodySchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  content: z
    .string()
    .trim()
    .min(1, "内容不能为空")
    .max(FEEDBACK_CONTENT_MAX, `内容最多 ${FEEDBACK_CONTENT_MAX} 字`),
  email: z.union([z.literal(""), z.string().trim().email("邮箱格式不正确")]).optional(),
  page_url: z
    .union([z.literal(""), z.string().trim().max(FEEDBACK_PAGE_URL_MAX, "页面地址过长")])
    .optional(),
  turnstileToken: z.string().optional(),
});

export type FeedbackBody = z.infer<typeof feedbackBodySchema>;

/** 状态流转表：new→read→resolved（单向，禁止回退/跳级）。 */
const NEXT: Record<FeedbackStatus, FeedbackStatus | null> = {
  new: "read",
  read: "resolved",
  resolved: null,
};

/** 下一步状态；终态返回 null。 */
export function nextStatus(status: FeedbackStatus): FeedbackStatus | null {
  return NEXT[status];
}

/** 是否允许从 from 流转到 to（单向线性：new→read→resolved）。 */
export function canTransition(from: FeedbackStatus, to: FeedbackStatus): boolean {
  return NEXT[from] === to;
}
