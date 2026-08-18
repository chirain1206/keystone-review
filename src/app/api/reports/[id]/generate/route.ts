import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/provider";
import { generateReport } from "@/lib/report/generate";
import { createSseResponse } from "@/lib/report/sse";

export const maxDuration = 60; // Vercel 60s 上限（ADR-001：并行后总时长 ≈ 最慢一章）

/**
 * POST /api/reports/:id/generate —— SSE 流式生成 6 章报告（FR-4）。
 * 事件：status / delta / done / error。幂等：已完成的章节自动跳过
 * （生成中途关页面后重新调用即可断点续跑）。
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

  return createSseResponse(async (writer) => {
    try {
      const result = await generateReport(user.id, id, {
        onStatus: (chapterNo, status) => writer.send("status", { chapterNo, status }),
        onDelta: (chapterNo, delta) => writer.send("delta", { chapterNo, delta }),
      });
      if (!result.report) {
        writer.send("error", { message: "复盘不存在或已被删除" });
        writer.close();
        return;
      }
      writer.send("done", {
        reportId: id,
        status: result.report.status,
        chapters: result.chapters.map((c) => ({
          chapterNo: c.chapterNo,
          status: c.status,
        })),
      });
    } catch (err) {
      // L-4：SSE 只回传友好文案，详细错误只写服务端日志（避免泄露上游细节）
      console.error(`[report] 生成失败（report=${id}）:`, err);
      writer.send("error", { message: "生成失败，请稍后重试" });
    } finally {
      writer.close();
    }
  });
}
