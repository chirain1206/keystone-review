import { createClient } from "@supabase/supabase-js";

/**
 * 浏览器端 Supabase 客户端（登录页 hash 隐式流登录用）。
 *
 * 注意：刻意不用 @supabase/ssr 的 createBrowserClient —— 该包 0.12.x 把 flowType
 * 硬编码为 "pkce"（写在展开用户选项之后，传 flowType 会被静默覆盖），会继续发成
 * 需经 supabase.co 验证页、依赖第三方 Cookie 的链接形态。这里用 supabase-js 的
 * createClient 显式切到隐式流，并关闭 URL 自动检测（hash 由登录页手动消费，避免
 * 自动初始化抢跑一次性 token）。
 *
 * 会话的权威存储是服务端 httpOnly cookie（经 /api/auth/session-sync 写入），
 * 故此处 persistSession 关闭，不往 localStorage 落 token。
 */
export function createSupabaseBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      auth: {
        flowType: "implicit",
        detectSessionInUrl: false,
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
