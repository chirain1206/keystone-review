import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/provider";
import { getRepo } from "@/lib/db";
import { getWclReportMeta } from "@/lib/wcl/adapter";
import type { ProcessedLog } from "@/lib/parser/schema";
import { estimateProcessedLogTokens } from "@/lib/ai/tokens";
import { enforceCreateLimits } from "@/lib/quota/enforce";

export const maxDuration = 30;

const bodySchema = z.object({
  url: z.string().trim().url("链接格式不正确"),
  compareUrl: z.string().trim().url("对比链接格式不正确").optional(),
  fightId: z.number().int().optional(),
  turnstileToken: z.string().optional(), // T9 人机验证
});

/**
 * POST /api/reports/from-link —— WCL 链接接入（FR-1/FR-3）。
 * 1) 校验链接（www / cn 双域）
 * 2) 拉取元数据（副本/层数/专精），仅大秘境（团本明确拒绝）
 * 3) 可选对比基准：获取失败不阻塞，降级为"本场不含对比章节"
 * 4) 以元数据建 report + 结构化日志（链接源不含事件级时间线 ——
 *    配额保护设计，AI 将按"数据不足"如实回答）
 * 失败提示完全对齐 FR-1 验收文案。
 */
export async function POST(req: NextRequest) {
  const res = NextResponse.json<{ ok: boolean }>({ ok: false });
  const user = await getCurrentUser(req, res);
  if (!user) {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "请粘贴有效的 Warcraft Logs 报告链接" }, { status: 400 });
  }
  const { url, compareUrl, fightId, turnstileToken } = parsed.data;

  // T9：人机验证 + 频控 + 每日额度
  const limited = await enforceCreateLimits(req, user.id, turnstileToken);
  if (limited) return limited;

  // 主链接元数据
  const metaResult = await getWclReportMeta(url);
  if (!metaResult.ok) {
    const status = metaResult.code === "FETCH_FAILED" ? 502 : 400;
    return NextResponse.json({ ok: false, code: metaResult.code, error: metaResult.message }, { status });
  }
  const fight =
    metaResult.meta.fights.find((f) => f.id === fightId) ??
    metaResult.meta.fights.sort((a, b) => (b.keystoneLevel ?? 0) - (a.keystoneLevel ?? 0))[0];

  // 对比基准（失败降级，不阻塞）
  let compareMeta: { url: string; title?: string; code?: string; note?: string } | null = null;
  if (compareUrl) {
    const { getCompareBaseline } = await import("@/lib/wcl/adapter");
    const baseline = await getCompareBaseline(compareUrl);
    if (baseline.ok) {
      compareMeta = {
        url: compareUrl,
        title: baseline.meta.title,
        code: baseline.meta.code,
        note: `对比基准：${baseline.meta.fights
          .slice(0, 3)
          .map((f) => `${f.name} ${f.keystoneLevel}层 ${f.success ? "限时" : "超时"}`)
          .join("；")}`,
      };
    } else {
      compareMeta = { url: compareUrl, note: "对比基准获取失败，本场不含对比章节" };
    }
  }

  // 以元数据构造结构化日志（链接源无事件级数据，AI 会按数据不足回答）
  const log: ProcessedLog = {
    version: 1,
    source: "link",
    combat: {
      dungeon: fight.name,
      level: fight.keystoneLevel ?? 2,
      startTime: 0,
      endTime: fight.durationSec * 1000,
      durationSec: fight.durationSec,
      success: fight.success,
      players: [
        { name: fight.playerName, class: fight.playerClass, spec: fight.playerSpec, role: "dps" },
      ],
      playerName: fight.playerName,
      playerClass: fight.playerClass,
      playerSpec: fight.playerSpec,
    },
    timeline: [
      {
        t: 0,
        ts: "00:00.000",
        type: "boss_phase",
        actor: fight.name,
        spell: fight.name,
        note: "WCL 链接数据源：仅战斗元数据，无事件级时间线（API 配额保护设计）；如需完整分析请上传 WoWCombatLog.txt 文件",
      },
    ],
    aggregate: {
      interrupts: [],
      deaths: [],
      cooldowns: [],
      vulnerablePhases: [],
      movement: [],
      perMinute: [],
    },
  };

  const repo = getRepo();
  const report = await repo.createReport({
    userId: user.id,
    sourceType: "link",
    dungeon: fight.name,
    level: fight.keystoneLevel ?? 2,
    spec: fight.playerSpec,
    playerName: fight.playerName,
    playerClass: fight.playerClass,
    result: fight.success,
    compareMeta,
  });
  await repo.saveProcessedLog({
    reportId: report.id,
    log,
    rawSize: 0,
    rawLines: 0,
    tokenEstimate: estimateProcessedLogTokens(log),
  });

  return NextResponse.json({
    ok: true,
    id: report.id,
    fight: {
      name: fight.name,
      level: fight.keystoneLevel,
      success: fight.success,
      durationSec: fight.durationSec,
      affixes: fight.affixes,
    },
    compareDegraded: compareUrl ? !compareMeta?.title : false,
  });
}
