import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/provider";
import { getRepo } from "@/lib/db";

export const maxDuration = 30;

/**
 * GET /api/reports/:id —— 复盘详情（报告 + 章节 + 问答 + 分享状态）。
 * 属主校验：非属主一律 404（不泄露存在性）。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = NextResponse.json<{ ok: boolean }>({ ok: false });
  const user = await getCurrentUser(req, res);
  if (!user) {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  }

  const repo = getRepo();
  const report = await repo.getReport(user.id, id);
  if (!report) {
    return NextResponse.json({ ok: false, error: "复盘不存在" }, { status: 404 });
  }
  const chapters = await repo.getChapters(user.id, id);
  const messages = await repo.listMessages(user.id, id);
  const shares = await repo.listShares(user.id, id);

  return NextResponse.json({
    ok: true,
    report,
    chapters,
    messages,
    share: shares.length > 0 ? { enabled: shares[0].enabled, token: shares[0].token } : null,
  });
}

/**
 * DELETE /api/reports/:id —— 删除复盘（FR-8）。
 * 级联删除章节/问答/分享（repo 层保证），他人分享链接同时失效。
 */
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
  const deleted = await getRepo().deleteReport(user.id, id);
  if (!deleted) {
    return NextResponse.json({ ok: false, error: "复盘不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
