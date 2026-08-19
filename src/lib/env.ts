/**
 * 环境变量统一入口。
 * 所有外部服务密钥一律从 server 端读取；NEXT_PUBLIC_* 仅暴露给浏览器。
 * 任一外部服务缺少真实密钥时，对应适配模块自动进入 mock 模式
 * （见 lib/ai、lib/auth、lib/wcl、lib/turnstile 各自的 provider）。
 */

function env(name: string): string {
  return process.env[name] ?? "";
}

/** 邮件发送方式（运行时动态读取，便于测试注入）。 */
export type EmailMode = "supabase" | "resend";

/**
 * 解析 EMAIL_MODE：默认 'supabase'；取值 'supabase' | 'resend'（大小写不敏感，非法值回退 supabase）。
 *  - supabase：Supabase Auth 自带邮件服务发送验证码（signInWithOtp，无需 SMTP/Resend 配置）
 *  - resend：应用经 Resend REST 适配器发送验证码（需 RESEND_API_KEY + EMAIL_FROM）
 */
export function getEmailMode(): EmailMode {
  return env("EMAIL_MODE").trim().toLowerCase() === "resend" ? "resend" : "supabase";
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

  // 邮件发送方式（见 getEmailMode）：supabase=Supabase 自带邮件；resend=Resend 适配器
  get emailMode(): EmailMode {
    return getEmailMode();
  },

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

  // FR-11 知识库：活跃补丁（缺省由库内最新非 general 补丁兜底；动态读取便于测试/热切换）
  get activePatch(): string {
    return env("ACTIVE_PATCH");
  },

  // FR-11 知识库：专家白名单（逗号分隔邮箱；为空则专家功能全部 403，安全默认）
  get expertEmails(): string {
    return env("EXPERT_EMAILS");
  },

  // FR-7 每日免费复盘额度：默认 3；仅本地验收可用 FREE_DAILY_REPORT_LIMIT 覆盖（缺失/非法回退默认 3）
  freeDailyReportLimit: env("FREE_DAILY_REPORT_LIMIT") || undefined,

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

/** 生产环境恒定必需的密钥/配置清单（缺任一 → 拒绝以 mock 降级运行）。 */
const BASE_REQUIRED_ENV: { key: string; label: string }[] = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", label: "NEXT_PUBLIC_SUPABASE_URL" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", label: "NEXT_PUBLIC_SUPABASE_ANON_KEY" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", label: "SUPABASE_SERVICE_ROLE_KEY" },
  { key: "DEEPSEEK_API_KEY", label: "DEEPSEEK_API_KEY" },
  { key: "TURNSTILE_SECRET_KEY", label: "TURNSTILE_SECRET_KEY" },
  { key: "NEXT_PUBLIC_TURNSTILE_SITE_KEY", label: "NEXT_PUBLIC_TURNSTILE_SITE_KEY" },
  { key: "WCL_CLIENT_ID", label: "WCL_CLIENT_ID" },
  { key: "WCL_CLIENT_SECRET", label: "WCL_CLIENT_SECRET" },
  { key: "EMBEDDING_API_KEY", label: "EMBEDDING_API_KEY" },
  { key: "EMBEDDING_BASE_URL", label: "EMBEDDING_BASE_URL" },
  { key: "EMBEDDING_MODEL", label: "EMBEDDING_MODEL" },
];

/** 仅 EMAIL_MODE=resend 时才要求的邮件密钥（supabase 模式由 Supabase 自带邮件发送，无需 Resend）。 */
const RESEND_REQUIRED_ENV: { key: string; label: string }[] = [
  { key: "RESEND_API_KEY", label: "RESEND_API_KEY" },
  { key: "EMAIL_FROM", label: "EMAIL_FROM" },
];

/**
 * 校验生产必需配置；返回缺失项列表（非生产环境恒为空数组）。
 * 只读 process.env 的"键名"与 APP_URL 前缀，绝不把密钥值写入返回值。
 * RESEND_API_KEY/EMAIL_FROM 仅在 EMAIL_MODE=resend 时强制要求。
 */
export function validateProductionEnv(): string[] {
  if (!isProduction()) return [];
  const missing: string[] = [];
  for (const { key, label } of BASE_REQUIRED_ENV) {
    if (!process.env[key]) missing.push(label);
  }
  if (getEmailMode() === "resend") {
    for (const { key, label } of RESEND_REQUIRED_ENV) {
      if (!process.env[key]) missing.push(label);
    }
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
