import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/provider";
import { getRepo } from "@/lib/db";
import { validateProcessedLog } from "@/lib/parser/schema";
import { estimateProcessedLogTokens, TOKEN_BUDGET_PER_COMBAT } from "@/lib/ai/tokens";
import { enforceCreateLimits } from "@/lib/quota/enforce";

export const maxDuration = 30;

/**
 * GET /api/reports —— 历史复盘列表（FR-8，按时间倒序）。
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.json<{ ok: boolean }>({ ok: false });
  const user = await getCurrentUser(req, res);
  if (!user) {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  }
  const reports = await getRepo().listReportsByUser(user.id);
  return NextResponse.json({ ok: true, reports });
}

const bodySchema = z.object({
  log: z.unknown(), // ProcessedLog（服务端 zod 校验）
  rawSize: z.number().int().min(0).default(0),
  rawLines: z.number().int().min(0).default(0),
  tokenEstimate: z.number().int().min(0).default(0), // 客户端估算（服务端重算为准）
  compareUrl: z.string().trim().url().optional(),
  turnstileToken: z.string().optional(), // T9 人机验证
});

/**
 * POST /api/reports —— 创建复盘（FR-2/FR-10）。
 * 接收浏览器本地解析出的结构化 JSON（原始文件永不上传）。
 * 服务端：
 *  1) 登录校验（401）
 *  2) 结构校验（zod，400）
 *  3) token 预算再校验（≤50K，413）—— 与客户端同口径
 *  4) 写入 report + processed_logs
 */
export async function POST(req: NextRequest) {
  const res = NextResponse.json<{ ok: boolean; error?: string; id?: string }>({ ok: false });
  const user = await getCurrentUser(req, res);
  if (!user) {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  }

  // L-6：请求体大小显式上限（2MB），超限直接 413（content-length 缺失时不拦截，
  // 由下方 zod + token 预算再校验兜底）。
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  const MAX_BODY_BYTES = 2 * 1024 * 1024;
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "请求数据过大" }, { status: 413 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "请求数据格式不正确" }, { status: 400 });
  }
  const { log, rawSize, rawLines, compareUrl, turnstileToken } = parsed.data;

  // T9：人机验证 + 频控 + 每日额度
  const limited = await enforceCreateLimits(req, user.id, turnstileToken);
  if (limited) return limited;

  const valid = validateProcessedLog(log);
  if (!valid.ok) {
    return NextResponse.json(
      { ok: false, error: `结构化数据校验失败：${valid.errors?.slice(0, 3).join("；")}` },
      { status: 400 },
    );
  }

  // FR-10 服务端 token 预算再校验（同口径：1 token ≈ 3 字符）
  const tokens = estimateProcessedLogTokens(valid.log);
  if (tokens > TOKEN_BUDGET_PER_COMBAT) {
    return NextResponse.json(
      {
        ok: false,
        error: `结构化数据超出 token 预算（${tokens} > ${TOKEN_BUDGET_PER_COMBAT}），请重新解析`,
      },
      { status: 413 },
    );
  }

  const c = valid.log!.combat;
  const report = await getRepo().createReport({
    userId: user.id,
    sourceType: valid.log!.source,
    dungeon: c.dungeon,
    level: c.level,
    spec: c.playerSpec,
    playerName: c.playerName,
    playerClass: c.playerClass,
    result: c.success,
    compareMeta: compareUrl
      ? { url: compareUrl, note: "对比基准待 WCL 解析（T8）" }
      : null,
  });
  await getRepo().saveProcessedLog({
    reportId: report.id,
    log: valid.log!,
    rawSize,
    rawLines,
    tokenEstimate: tokens,
  });

  return NextResponse.json({ ok: true, id: report.id });
}
