import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAuthProvider } from "@/lib/auth/provider";
import { checkRateLimit } from "@/lib/auth/guard";
import { verifyTurnstile } from "@/lib/turnstile/adapter";

export const maxDuration = 30;

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email("邮箱格式不正确"),
  turnstileToken: z.string().optional(), // T9 接入人机验证后校验
});

/**
 * POST /api/auth/request-code —— 请求登录验证码（FR-7）。
 * 频控：同一邮箱 10 分钟内最多 3 次；同一 IP 10 分钟内最多 5 次。
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "请输入有效的邮箱地址" }, { status: 400 });
  }
  const { email, turnstileToken } = parsed.data;

  // T9：登录接口人机验证（配置密钥后强制；mock 模式放行）
  const tv = await verifyTurnstile(turnstileToken, ip);
  if (!tv.ok) {
    return NextResponse.json({ ok: false, error: tv.error }, { status: 403 });
  }

  const byEmail = checkRateLimit(`code:email:${email}`, 3, 10 * 60 * 1000);
  if (!byEmail.ok) {
    return NextResponse.json(
      { ok: false, error: `验证码请求过于频繁，请 ${byEmail.retryAfterSec} 秒后再试` },
      { status: 429 },
    );
  }
  const byIp = checkRateLimit(`code:ip:${ip}`, 5, 10 * 60 * 1000);
  if (!byIp.ok) {
    return NextResponse.json(
      { ok: false, error: "验证码请求过于频繁，请稍后再试" },
      { status: 429 },
    );
  }

  const res = NextResponse.json<{ ok: boolean; error?: string; mockMode?: boolean }>({ ok: true });
  const auth = createAuthProvider(req, res);
  const result = await auth.requestCode(email);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 429 });
  }
  return NextResponse.json({
    ok: true,
    mockMode: auth.mode === "mock",
    mockHint:
      auth.mode === "mock"
        ? "开发模式：验证码已打印到服务端控制台日志（[email:mock] 行）"
        : undefined,
  });
}
