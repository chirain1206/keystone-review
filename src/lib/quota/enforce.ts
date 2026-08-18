import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/auth/guard";
import { getRepo } from "@/lib/db";
import { getClientIp } from "@/lib/net/client-ip";
import {
  checkDailyQuota,
  DAILY_REPORT_LIMIT,
  QUOTA_EXHAUSTED_MESSAGE,
} from "@/lib/quota/quota";
import { verifyTurnstile } from "@/lib/turnstile/adapter";

/**
 * 创建复盘的统一防护（T9）：Turnstile 人机验证 → IP/账号频控 → 每日额度。
 * 返回 null 表示放行；否则返回应直接回给客户端的错误响应。
 */
export async function enforceCreateLimits(
  req: NextRequest,
  userId: string,
  turnstileToken?: string,
): Promise<NextResponse | null> {
  const ip = getClientIp(req);

  // 1) Turnstile（配置密钥时强制；mock 模式放行）
  const tv = await verifyTurnstile(turnstileToken, ip);
  if (!tv.ok) {
    return NextResponse.json({ ok: false, error: tv.error }, { status: 403 });
  }

  // 2) 频控：IP 10 分钟 ≤10 次；账号 10 分钟 ≤6 次
  const byIp = checkRateLimit(`create:ip:${ip}`, 10, 10 * 60 * 1000);
  if (!byIp.ok) {
    return NextResponse.json({ ok: false, error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }
  const byUser = checkRateLimit(`create:user:${userId}`, 6, 10 * 60 * 1000);
  if (!byUser.ok) {
    return NextResponse.json({ ok: false, error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  // 3) 每日免费额度（按用户时区自然日，每账号 3 次）
  const profile = await getRepo().getProfile(userId);
  const timeZone = profile?.timezone || "Asia/Shanghai";
  const quota = await checkDailyQuota(userId, timeZone);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: QUOTA_EXHAUSTED_MESSAGE,
        quota: {
          // 展示口径封顶为 limit（避免暴露超量后的真实计数）
          used: Math.min(quota.used, DAILY_REPORT_LIMIT),
          limit: quota.limit,
          resetAt: quota.resetAt,
        },
      },
      { status: 429 },
    );
  }
  return null;
}
