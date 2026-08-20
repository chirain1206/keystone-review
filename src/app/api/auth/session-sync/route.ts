import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/auth/supabase-auth";
import { getRepo } from "@/lib/db";

export const maxDuration = 30;

const bodySchema = z.object({
  accessToken: z.string().min(1, "缺少 access_token"),
  refreshToken: z.string().optional(),
});

/**
 * POST /api/auth/session-sync —— 隐式流登录的会话落库（FR-7 隐式流增强）。
 * 隐式流下邮件链接的 token 挂在 URL hash，浏览器端 setSession 后调用本接口，
 * 服务端用 createServerClient（桥接 response cookies）再次 setSession，把会话
 * 写入 httpOnly SSR cookie（供后续 SSR / API 路由读会话），并 upsert profile。
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "会话无效，请重新登录" }, { status: 400 });
  }
  const { accessToken, refreshToken } = parsed.data;

  // 注意：cookie 必须写在这个 res 上并返回它（Supabase 会话 cookie 挂在其上）
  const res = NextResponse.json<{ ok: boolean; error?: string }>({ ok: false });
  const supabase = createSupabaseServerClient(req, res);
  try {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken ?? "",
    });
    if (error || !data.user) {
      // 打日志进 Vercel 运行日志，方便排查线上「链接已失效」的真实原因
      console.error("[session-sync] setSession 失败:", error?.message ?? "缺少 user");
      return NextResponse.json({ ok: false, error: "会话无效，请重新登录" }, { status: 401 });
    }

    await getRepo().upsertProfile({
      id: data.user.id,
      email: data.user.email ?? "",
      timezone: "Asia/Shanghai",
    });

    return NextResponse.json({ ok: true }, { headers: res.headers, status: 200 });
  } catch (err) {
    console.error("[session-sync] setSession 抛错:", err);
    return NextResponse.json({ ok: false, error: "会话无效，请重新登录" }, { status: 401 });
  }
}
