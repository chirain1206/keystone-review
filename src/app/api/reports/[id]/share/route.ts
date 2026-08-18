import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/provider";
import { createOrGetShare, disableShare } from "@/lib/share/service";
import { envConfig } from "@/lib/env";

export const maxDuration = 30;

/**
 * POST /api/reports/:id/share —— 开启分享（FR-9），返回唯一链接。
 * DELETE /api/reports/:id/share —— 关闭分享（原链接立即失效）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = NextResponse.json<{ ok: boolean }>({ ok: false });
  const user = await getCurrentUser(req, res);
  if (!user) {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  }
  const result = await createOrGetShare(user.id, id);
  if (!result.ok || !result.share) {
    return NextResponse.json({ ok: false, error: result.error ?? "开启分享失败" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    token: result.share.token,
    enabled: result.share.enabled,
    url: `${envConfig.appUrl}/s/${result.share.token}`,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = NextResponse.json<{ ok: boolean }>({ ok: false });
  const user = await getCurrentUser(req, res);
  if (!user) {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  }
  const result = await disableShare(user.id, id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "关闭分享失败" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
