import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAuthProvider } from "@/lib/auth/provider";

export const maxDuration = 30;

const bodySchema = z.object({
  tokenHash: z.string().min(1, "缺少登录凭证"),
  // 可选兼容：前端把 localStorage 最近邮箱一并带上；服务端优先用 token_hash 验证
  email: z.string().trim().toLowerCase().email("邮箱格式不正确").optional(),
  // token 来源：新形式 token_hash / 老形式 code（类型歧义时服务端回退 signup 验证）
  source: z.enum(["token_hash", "code"]).optional(),
});

/**
 * POST /api/auth/verify-link —— 邮箱魔法链接登录（FR-7 增强，统一为链接登录）。
 * 生产 Supabase 发送 sign-in 链接，用户点击后带 ?token_hash=...&type=email
 * （老形式 ?code=...）回到站点；本接口用 verifyOtp({ type: "email", token_hash })
 * 建立会话（cookie 由现有 createServerClient 桥接），成功后前端跳转首页 / 历史。
 * source=code 且 email 验证失败时，服务端回退 type:"signup" 兼容「确认注册链接」。
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "链接已失效，请重新登录" }, { status: 400 });
  }
  const { tokenHash, email, source } = parsed.data;

  // 注意：cookie 必须写在这个 res 上并返回它（Supabase 会话 cookie 挂在其上）
  const res = NextResponse.json<{ ok: boolean; error?: string; email?: string }>({ ok: false });
  const auth = createAuthProvider(req, res);
  const result = await auth.verifyLink(tokenHash, email, source);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
  }
  return NextResponse.json(
    { ok: true, email: result.user?.email },
    { headers: res.headers, status: 200 },
  );
}
