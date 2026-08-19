/**
 * 登录表单文案与流程纯函数（FR-7 统一为「邮箱链接登录」）。
 * 与 React 组件解耦，便于在 node 环境直接单测（无需 jsdom）。
 *
 * 流程约定：
 *  - 生产（Supabase 发 sign-in 链接）：单步——输邮箱 → 点「发送登录链接」→
 *    提示查收邮件点击链接，不再要求输 6 位验证码。
 *  - mock（无 Supabase 密钥，本地发 6 位验证码）：发送后保留输码步骤。
 */

/** 「发送」按钮文案（统一为链接登录）。 */
export const LOGIN_EMAIL_SEND_LABEL = "发送登录链接";

/** 发送成功后（生产）的提示文案。 */
export const LOGIN_LINK_SENT_MESSAGE = "已发送登录链接至邮箱，请点击邮件中的链接完成登录";

/** 发送成功后（生产）的兜底提示：查垃圾箱 / 重新发送。 */
export const LOGIN_LINK_RESEND_HINT = "没收到？请检查垃圾箱（或推广邮件），或点击重新发送";

/** 登录表单步骤。 */
export type LoginStep = "email" | "sent" | "code";

/**
 * 发送成功后进入的下一步：
 *  - mock（无 Supabase 密钥）→ "code"：保留 6 位验证码输入
 *  - 生产 → "sent"：提示查收邮件点击链接
 */
export function nextStepAfterSend(mockMode: boolean): "sent" | "code" {
  return mockMode ? "code" : "sent";
}
