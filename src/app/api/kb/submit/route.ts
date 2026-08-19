import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/provider";
import { authorizeExpert } from "@/lib/expert";
import { submitCommunityKnowledge } from "@/lib/kb/community";

export const maxDuration = 30;

const bodySchema = z.object({
  class: z.string(),
  spec: z.string(),
  title: z.string(),
  content: z.string(),
  sourceUrl: z.string().optional(),
});

/**
 * POST /api/kb/submit —— 专家提交社区知识（origin=community、status=candidate）。
 * 仅白名单（EXPERT_EMAILS）可用；候选条目不注入正式分析。
 */
export async function POST(req: NextRequest) {
  const res = NextResponse.json<{ ok: boolean; error?: string; id?: string; patch?: string }>({ ok: false });
  const user = await getCurrentUser(req, res);
  const gate = authorizeExpert(user);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "请求数据格式不正确" }, { status: 400 });
  }
  const { class: cls, spec, title, content, sourceUrl } = parsed.data;

  try {
    const result = await submitCommunityKnowledge(
      { class: cls, spec, title, content, sourceUrl },
      user!.email,
    );
    return NextResponse.json({
      ok: true,
      id: result.id,
      patch: result.patch,
      duplicates: result.duplicates,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
