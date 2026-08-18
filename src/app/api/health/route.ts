import { envConfig, validateProductionEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/health —— 存活与依赖模式探针（不泄露任何密钥）。
 *  - 生产：配置缺失 → 503 + 缺失项列表；配置齐全 → 仅 {ok:true}（不暴露内部模式）。
 *  - 非生产：返回各外部服务模式（mock/real），便于开发排障。
 */
export async function GET() {
  const missing = validateProductionEnv();
  if (missing.length > 0) {
    return Response.json(
      { ok: false, error: "配置不完整，服务不可用", missing },
      { status: 503 },
    );
  }

  if (process.env.NODE_ENV !== "production") {
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

  return Response.json({ ok: true });
}
