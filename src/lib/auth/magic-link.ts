/**
 * 邮箱魔法链接登录的客户端辅助（FR-7 增强）。
 *
 * 生产 Supabase 对新用户首次登录发送 sign-in 链接，回调形式：
 *   - 新形式：?token_hash=...&type=email
 *   - 老形式：?code=...
 * parseMagicLinkToken 为纯函数（便于单测）；localStorage 读写带 window 守卫，
 * 可被客户端组件安全调用（SSR / 隐私模式下静默降级）。
 */

/** localStorage 键：最近一次请求登录使用的邮箱。 */
export const LAST_EMAIL_KEY = "wow-analyzer:last-email";

/** 魔法链接 token 来源：新形式 ?token_hash=...，老形式 ?code=...。 */
export type MagicLinkSource = "token_hash" | "code";

/**
 * 解析魔法链接回调 query 并区分来源：
 *  - 新形式 token_hash → source:"token_hash"（sign-in 链接，type 确定）
 *  - 老形式 code → source:"code"（类型歧义：可能是 sign-in 或 sign-up 链接）
 * 无 / 空参数返回 null。
 */
export function parseMagicLinkSource(
  search: string,
): { tokenHash: string; source: MagicLinkSource } | null {
  const params = new URLSearchParams(search);
  const tokenHash = params.get("token_hash")?.trim();
  if (tokenHash) return { tokenHash, source: "token_hash" };
  const code = params.get("code")?.trim();
  if (code) return { tokenHash: code, source: "code" };
  return null;
}

/**
 * 解析魔法链接回调 query：取 token_hash（新）或 code（老）作为 token_hash 等价物。
 * 无 / 空参数返回 null。
 */
export function parseMagicLinkToken(search: string): string | null {
  return parseMagicLinkSource(search)?.tokenHash ?? null;
}

/** 登录魔法链接失效 / 过期的友好提示文案。 */
export const AUTH_LINK_EXPIRED_MESSAGE = "登录链接已失效或过期，请重新获取验证码";

/**
 * 解析魔法链接回调的 error 参数：Supabase 在链接失效 / 过期时重定向到
 * ?error=access_denied&error_code=otp_expired&error_description=...。
 * 命中（存在 error 或 error_description 参数）则返回友好提示文案；否则返回 null。
 * 6 位验证码路径不经过 URL 回调，故此解析不影响该路径。
 */
export function parseAuthLinkError(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.has("error") || params.has("error_description")) {
    return AUTH_LINK_EXPIRED_MESSAGE;
  }
  return null;
}

/** 读取最近邮箱（SSR / 无 window / 读取失败 → null）。 */
export function readLastEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_EMAIL_KEY);
  } catch {
    return null;
  }
}

/** 持久化最近邮箱（失败静默忽略，不阻塞交互）。 */
export function writeLastEmail(email: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    // 隐私模式 / 存储不可用时静默降级
  }
}
