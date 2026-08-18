import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/provider";
import { regenerateChapter } from "@/lib/report/generate";
import { createSseResponse } from "@/lib/report/sse";

export const maxDuration = 60;

/**
 * POST /api/reports/:id/chapters/:n —— 单章重试（SSE）。
 * 某章失败只重跑该章（T5 断点重试）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; n: string }> },
) {
  const { id, n } = await params;
  const chapterNo = Number(n);
  if (!Number.isInteger(chapterNo) || chapterNo < 1 || chapterNo > 6) {
    return NextResponse.json({ ok: false, error: "章节号无效（1–6）" }, { status: 400 });
  }
  const res = NextResponse.json<{ ok: boolean }>({ ok: false });
  const user = await getCurrentUser(req, res);
  if (!user) {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  }

  return createSseResponse(async (writer) => {
    try {
      const chapter = await regenerateChapter(user.id, id, chapterNo, {
        onStatus: (no, status) => writer.send("status", { chapterNo: no, status }),
        onDelta: (no, delta) => writer.send("delta", { chapterNo: no, delta }),
      });
      if (!chapter) {
        writer.send("error", { message: "复盘不存在或已被删除" });
      } else {
        writer.send("done", {
          reportId: id,
          chapterNo,
          status: chapter.status,
          content: chapter.status === "done" ? chapter.content : undefined,
        });
      }
    } catch (err) {
      writer.send("error", {
        message: err instanceof Error ? err.message : "服务繁忙，请稍后重试",
      });
    } finally {
      writer.close();
    }
  });
}
