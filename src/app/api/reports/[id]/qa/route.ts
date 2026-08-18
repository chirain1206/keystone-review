import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/provider";
import { askQuestion } from "@/lib/qa/service";
import { ROUNDS_EXCEEDED_MESSAGE } from "@/lib/qa/prompts";
import { createSseResponse } from "@/lib/report/sse";

export const maxDuration = 60;

const bodySchema = z.object({
  question: z.string().trim().min(1, "问题不能为空").max(500, "问题过长（≤500 字）"),
  conversationId: z.string().trim().nullable().optional(),
});

/**
 * POST /api/reports/:id/qa —— 流式问答（FR-6）。
 * 事件：delta / done / refused / error。
 * 单场对话 ≤10 轮；违规问题礼貌拒绝；回答带时间戳证据。
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

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "请求格式不正确" }, { status: 400 });
  }
  const { question, conversationId } = parsed.data;

  return createSseResponse(async (writer) => {
    try {
      const result = await askQuestion(
        user.id,
        id,
        question,
        conversationId ?? null,
        { onDelta: (text) => writer.send("delta", { text }) },
      );

      if (result.roundsExceeded) {
        writer.send("refused", { reason: ROUNDS_EXCEEDED_MESSAGE, conversationId: result.conversationId });
      } else if (result.refused) {
        writer.send("refused", { reason: result.refused.reason, conversationId: result.conversationId });
        writer.send("delta", { text: result.answer });
      } else {
        writer.send("done", {
          conversationId: result.conversationId,
          answer: result.answer,
          roundsUsed: result.roundsUsed,
          roundsLeft: result.roundsLeft,
        });
      }
    } catch (err) {
      // L-4：SSE 只回传友好文案，详细错误只写服务端日志（避免泄露上游细节）
      console.error(`[qa] 生成失败（report=${id}）:`, err);
      writer.send("error", { message: "生成失败，请稍后重试" });
    } finally {
      writer.close();
    }
  });
}
