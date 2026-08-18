import { envConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/health —— 存活与依赖模式探针（不泄露任何密钥）。
 * 返回 ok 且附各外部服务的模式（mock/real），便于部署排障。
 */
export async function GET() {
  return Response.json({
    ok: true,
    service: "wow-analyzer",
    time: new Date().toISOString(),
    modes: {
      supabase: envConfig.supabaseEnabled ? "real" : "mock",
      ai: envConfig.deepseekApiKey ? "real" : "mock",
      email: envConfig.resendApiKey ? "real" : "mock",
      wcl: envConfig.wclClientId && envConfig.wclClientSecret ? "real" : "mock",
      turnstile: envConfig.turnstileSecretKey ? "real" : "mock",
    },
  });
}
