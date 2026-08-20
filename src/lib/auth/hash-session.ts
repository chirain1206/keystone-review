/**
 * 隐式流（implicit flow）邮箱链接登录的 hash 解析（纯函数，便于单测）。
 *
 * 隐式流下，signInWithOtp 的邮件链接直接指向 emailRedirectTo（我们的 /login），
 * token 挂在 URL hash 里，形如：
 *   /login#access_token=...&expires_in=3600&expires_at=...&refresh_token=...&token_type=bearer&type=magiclink
 * 全程不经过 supabase.co 验证页，也不依赖第三方 Cookie（现代浏览器拦第三方 Cookie
 * 时 PKCE 流会失效，隐式流正是为此兜底）。
 */

export interface HashSessionTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * 从 URL hash 解析隐式流会话 token。
 * 无 access_token 时返回 null（此时维持既有 token_hash/code query 逻辑不变）。
 */
export function parseHashSession(hash: string): HashSessionTokens | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  const accessToken = params.get("access_token")?.trim();
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: params.get("refresh_token")?.trim() ?? "",
  };
}
