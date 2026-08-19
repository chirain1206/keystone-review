import { NextRequest, NextResponse } from "next/server";
import { createAuthProvider } from "@/lib/auth/provider";
import { isExpert } from "@/lib/expert";

export const maxDuration = 30;

/** GET /api/auth/me —— 当前登录用户；未登录返回 401。 */
export async function GET(req: NextRequest) {
  const res = NextResponse.json<{ ok: boolean }>({ ok: false });
  const auth = createAuthProvider(req, res);
  const user = await auth.getSession();
  if (!user) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email },
    // 专家白名单标记：客户端据此显隐「知识库」入口（白名单解析在服务端，不泄露他人邮箱）
    isExpert: isExpert(user.email),
  });
}
