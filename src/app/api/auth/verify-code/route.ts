import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAuthProvider } from "@/lib/auth/provider";

export const maxDuration = 30;

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email("邮箱格式不正确"),
  code: z.string().regex(/^\d{6}$/, "验证码为 6 位数字"),
});

/**
 * POST /api/auth/verify-code —— 校验验证码并建立会话（FR-7）。
 * 错 5 次锁定该邮箱 10 分钟（guard 层，两种模式一致）。
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "邮箱或验证码格式不正确" }, { status: 400 });
  }
  const { email, code } = parsed.data;

  // 注意：cookie 必须写在这个 res 上并返回它（mock 会话/ Supabase cookie 都挂在上面）
  const res = NextResponse.json<{ ok: boolean; error?: string; email?: string }>({ ok: false });
  const auth = createAuthProvider(req, res);
  const result = await auth.verifyCode(email, code);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
  }
  return NextResponse.json(
    { ok: true, email: result.user?.email },
    { headers: res.headers, status: 200 },
  );
}
