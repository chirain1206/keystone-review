import { NextResponse, type NextRequest } from "next/server";

/**
 * 全局安全头（T13，Next 16 proxy 约定，替代旧 middleware）：
 *  - HTTPS 由部署平台（Vercel）提供并在 APP_URL=https://… 时给会话 cookie
 *    加 Secure 标记（见 lib/auth/types.ts）
 *  - 安全响应头：nosniff / 禁内嵌（防点击劫持）/ 引用策略 / CSP
 *  - CSP 放行 Turnstile 脚本域；开发模式额外放行 unsafe-eval（HMR）
 */
export function proxy(request: NextRequest) {
  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  const devEval = process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : "";
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${devEval} https://challenges.cloudflare.com`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "frame-src https://challenges.cloudflare.com",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
