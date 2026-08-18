/**
 * 环境变量统一入口。
 * 所有外部服务密钥一律从 server 端读取；NEXT_PUBLIC_* 仅暴露给浏览器。
 * 任一外部服务缺少真实密钥时，对应适配模块自动进入 mock 模式
 * （见 lib/ai、lib/auth、lib/wcl、lib/turnstile 各自的 provider）。
 */

function env(name: string): string {
  return process.env[name] ?? "";
}

export const envConfig = {
  appUrl: env("APP_URL") || "http://localhost:3000",

  // Supabase：三项齐全才启用真实 Supabase（Auth + Postgres），否则 mock 模式
  supabaseUrl: env("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
  get supabaseEnabled(): boolean {
    return Boolean(this.supabaseUrl && this.supabaseAnonKey);
  },

  // DeepSeek
  deepseekApiKey: env("DEEPSEEK_API_KEY"),
  deepseekBaseUrl: env("DEEPSEEK_BASE_URL") || "https://api.deepseek.com",
  deepseekModel: env("DEEPSEEK_MODEL") || "deepseek-chat",

  // Resend
  resendApiKey: env("RESEND_API_KEY"),
  emailFrom: env("EMAIL_FROM") || "WoW 复盘教练 <onboarding@wow-analyzer.local>",

  // Warcraft Logs v2 API
  wclClientId: env("WCL_CLIENT_ID"),
  wclClientSecret: env("WCL_CLIENT_SECRET"),

  // Cloudflare Turnstile
  turnstileSiteKey: env("NEXT_PUBLIC_TURNSTILE_SITE_KEY"),
  turnstileSecretKey: env("TURNSTILE_SECRET_KEY"),

  devLogCodes: env("DEV_LOG_CODES") === "true",
} as const;

export function isServer(): boolean {
  return typeof window === "undefined";
}
