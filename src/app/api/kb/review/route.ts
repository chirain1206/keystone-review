import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/provider";
import { authorizeExpert } from "@/lib/expert";
import { getKbStore } from "@/lib/kb";
import { reviewCandidate } from "@/lib/kb/community";

export const maxDuration = 30;

/**
 * GET /api/kb/review —— 列出候选（status=candidate）条目（内容/来源/提交时间），仅白名单。
 * POST /api/kb/review {id, action} —— approve→active / reject→deprecated（复用 updateStatus + 审计）。
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.json<{ ok: boolean; error?: string }>({ ok: false });
  const user = await getCurrentUser(req, res);
  const gate = authorizeExpert(user);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const rows = await getKbStore().list({ status: "candidate" });
  return NextResponse.json({ ok: true, items: rows });
}

const bodySchema = z.object({
  id: z.string().min(1),
  action: z.enum(["approve", "reject"]),
});

export async function POST(req: NextRequest) {
  const res = NextResponse.json<{ ok: boolean; error?: string; status?: string }>({ ok: false });
  const user = await getCurrentUser(req, res);
  const gate = authorizeExpert(user);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "请求数据格式不正确" }, { status: 400 });
  }
  const { id, action } = parsed.data;

  try {
    const result = await reviewCandidate(id, action, user!.email);
    return NextResponse.json({ ok: true, status: result.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
