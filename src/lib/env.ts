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

  // FR-11 知识库：嵌入服务（SiliconFlow bge-m3，OpenAI 兼容协议，1024 维）
  embeddingApiKey: env("EMBEDDING_API_KEY"),
  embeddingBaseUrl: env("EMBEDDING_BASE_URL") || "https://api.siliconflow.cn",
  embeddingModel: env("EMBEDDING_MODEL") || "BAAI/bge-m3",
  get embeddingEnabled(): boolean {
    return Boolean(this.embeddingApiKey);
  },

  // FR-11 知识库：活跃补丁（缺省由库内最新非 general 补丁兜底）
  activePatch: env("ACTIVE_PATCH"),

  devLogCodes: env("DEV_LOG_CODES") === "true",
} as const;

export function isServer(): boolean {
  return typeof window === "undefined";
}

// ---------- 生产环境 fail-fast（M-2） ----------

/** 是否为生产环境（运行时动态判定，便于测试注入）。 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** 生产环境必需的密钥/配置清单（缺任一 → 拒绝以 mock 降级运行）。 */
const PRODUCTION_REQUIRED_ENV: { key: string; label: string }[] = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", label: "NEXT_PUBLIC_SUPABASE_URL" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", label: "NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", label: "SUPABASE_SERVICE_ROLE_KEY" },
  { key: "RESEND_API_KEY", label: "RESEND_API_KEY" },
  { key: "EMAIL_FROM", label: "EMAIL_FROM" },
  { key: "DEEPSEEK_API_KEY", label: "DEEPSEEK_API_KEY" },
  { key: "TURNSTILE_SECRET_KEY", label: "TURNSTILE_SECRET_KEY" },
  { key: "NEXT_PUBLIC_TURNSTILE_SITE_KEY", label: "NEXT_PUBLIC_TURNSTILE_SITE_KEY" },
  { key: "WCL_CLIENT_ID", label: "WCL_CLIENT_ID" },
  { key: "WCL_CLIENT_SECRET", label: "WCL_CLIENT_SECRET" },
  { key: "EMBEDDING_API_KEY", label: "EMBEDDING_API_KEY" },
  { key: "EMBEDDING_BASE_URL", label: "EMBEDDING_BASE_URL" },
  { key: "EMBEDDING_MODEL", label: "EMBEDDING_MODEL" },
];

/**
 * 校验生产必需配置；返回缺失项列表（非生产环境恒为空数组）。
 * 只读 process.env 的"键名"与 APP_URL 前缀，绝不把密钥值写入返回值。
 */
export function validateProductionEnv(): string[] {
  if (!isProduction()) return [];
  const missing: string[] = [];
  for (const { key, label } of PRODUCTION_REQUIRED_ENV) {
    if (!process.env[key]) missing.push(label);
  }
  const appUrl = process.env.APP_URL ?? "";
  if (!appUrl.startsWith("https://")) {
    missing.push("APP_URL（必须以 https:// 开头）");
  }
  return missing;
}

/** 生产环境缺失指定密钥时抛错（禁止静默 mock 回退）；非生产环境为 no-op。 */
export function requireProductionEnv(...keys: string[]): void {
  if (!isProduction()) return;
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `生产环境缺少必要配置，已拒绝以 mock 降级运行（安全 fail-fast）：${missing.join(", ")}`,
    );
  }
}
