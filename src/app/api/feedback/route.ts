import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/provider";
import { checkRateLimit } from "@/lib/auth/guard";
import { getClientIp } from "@/lib/net/client-ip";
import { authorizeExpert } from "@/lib/expert";
import { getFeedbackStore } from "@/lib/feedback";
import { canTransition, feedbackBodySchema } from "@/lib/feedback/domain";
import { FEEDBACK_STATUSES, type FeedbackStatus } from "@/lib/feedback/types";
import { verifyTurnstile } from "@/lib/turnstile/adapter";

export const maxDuration = 30;

const LIST_LIMIT = 100;
const IP_RATE_MAX = 3;
const IP_RATE_WINDOW_MS = 60 * 1000;

/**
 * GET /api/feedback —— 专家查看反馈（最近 100 条，倒序），仅白名单。
 * 查询参数（可选）：status=new|read|resolved。
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.json<{ ok: boolean; error?: string }>({ ok: false });
  const user = await getCurrentUser(req, res);
  const gate = authorizeExpert(user);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const statusRaw = req.nextUrl.searchParams.get("status")?.trim();
  const status = statusRaw && (FEEDBACK_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as FeedbackStatus)
    : undefined;

  const rows = await getFeedbackStore().list({ status, limit: LIST_LIMIT });
  return NextResponse.json({ ok: true, items: rows });
}

/**
 * POST /api/feedback —— 公开提交反馈（内测用户/访客）。
 * 校验 → Turnstile → IP 频控（每分钟 ≤3）→ 写入 feedback 表（service role）。
 * 登录态可选：已登录自动关联 user_id；访客可自填邮箱。
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  const parsed = feedbackBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "请求数据格式不正确" }, { status: 400 });
  }
  const { category, content, email, page_url, turnstileToken } = parsed.data;

  // Turnstile（配置密钥时强制；mock 模式放行）
  const tv = await verifyTurnstile(turnstileToken, ip);
  if (!tv.ok) {
    return NextResponse.json({ ok: false, error: tv.error }, { status: 403 });
  }

  // IP 频控：每 IP 每分钟 ≤3 条
  const byIp = checkRateLimit(`feedback:ip:${ip}`, IP_RATE_MAX, IP_RATE_WINDOW_MS);
  if (!byIp.ok) {
    return NextResponse.json(
      { ok: false, error: `提交过于频繁，请 ${byIp.retryAfterSec} 秒后再试` },
      { status: 429 },
    );
  }

  // 登录态（可选）：会话读取失败不阻塞公开提交。
  let userId: string | null = null;
  try {
    const res = NextResponse.json({ ok: false });
    const user = await getCurrentUser(req, res);
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }

  const row = await getFeedbackStore().create({
    userId,
    email: email?.trim() ? email.trim().toLowerCase() : null,
    category,
    content,
    pageUrl: page_url?.trim() ? page_url.trim() : null,
  });

  return NextResponse.json({ ok: true, id: row.id });
}

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(FEEDBACK_STATUSES),
});

/**
 * PATCH /api/feedback —— 专家标记状态（new→read→resolved 单向），仅白名单。
 * 最小实现：复用本路由文件，body {id, status}。
 */
export async function PATCH(req: NextRequest) {
  const res = NextResponse.json<{ ok: boolean; error?: string; status?: string }>({ ok: false });
  const user = await getCurrentUser(req, res);
  const gate = authorizeExpert(user);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "请求数据格式不正确" }, { status: 400 });
  }
  const { id, status } = parsed.data;

  const current = await getFeedbackStore().get(id);
  if (!current) {
    return NextResponse.json({ ok: false, error: "未找到该反馈" }, { status: 404 });
  }
  if (!canTransition(current.status, status)) {
    return NextResponse.json(
      { ok: false, error: `无法从 ${current.status} 变更为 ${status}` },
      { status: 400 },
    );
  }

  await getFeedbackStore().updateStatus(id, status);
  return NextResponse.json({ ok: true, status });
}
