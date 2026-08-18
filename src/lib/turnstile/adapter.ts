import { envConfig, requireProductionEnv } from "@/lib/env";

/**
 * Cloudflare Turnstile 人机验证适配器（T9）。
 *  - 配置 TURNSTILE_SECRET_KEY → 真实 siteverify 校验（登录/创建报告接口）
 *  - 未配置（开发/mock）→ 放行（部署阶段配置后自动生效；
 *    绕过人机验证的脚本请求在真实模式下会被 403 拒绝）
 */

export async function verifyTurnstile(
  token: string | undefined,
  ip: string,
): Promise<{ ok: boolean; error?: string }> {
  // 生产 fail-fast：缺密钥直接抛错，禁止静默放行（M-2）
  requireProductionEnv("TURNSTILE_SECRET_KEY");
  if (!envConfig.turnstileSecretKey) {
    // mock/开发模式：未配置密钥时跳过（真实配置后自动启用）
    return { ok: true };
  }
  if (!token) {
    return { ok: false, error: "人机验证未通过，请完成验证后重试" };
  }
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: envConfig.turnstileSecretKey,
        response: token,
        remoteip: ip,
      }),
    });
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success) return { ok: true };
    return { ok: false, error: "人机验证未通过，请完成验证后重试" };
  } catch {
    return { ok: false, error: "人机验证服务不可用，请稍后重试" };
  }
}
