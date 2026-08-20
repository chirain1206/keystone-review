import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/provider";
import { getRepo } from "@/lib/db";
import { getWclReportMeta, getCompareBaseline, selectFight } from "@/lib/wcl/adapter";
import { applyFightSpecs, filterPlayersByFight } from "@/lib/wcl/players";
import { getFightEvents } from "@/lib/wcl/events";
import { buildProcessedLogFromWcl, buildPlaceholderLinkLog } from "@/lib/wcl/to-processed";
import { estimateProcessedLogTokens } from "@/lib/ai/tokens";

// 事件分页拉取 + 对比基准是本项目最耗时的 WCL 操作，独占 60s（Vercel Hobby 上限）
export const maxDuration = 60;

/**
 * POST /api/reports/:id/enrich —— FR-1 两步式创建的第二步：拉取事件级数据 + 对比基准，
 * 覆盖创建时保存的占位日志。幂等：占位日志没有 enrich 标记时直接返回 already。
 * 失败不阻塞报告生成：占位日志保留「数据不足」语义，报告页按元数据分析。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
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

  const logRec = await repo.getProcessedLogByReportId(id);
  const pending = logRec?.log?.enrich;
  if (!pending) {
    return NextResponse.json({ ok: true, already: true });
  }
  console.log("[enrich] 开始:", { reportId: id, fightId: pending.fightId, playerId: pending.playerId, hasCompare: Boolean(pending.compareUrl) });

  // 重新取主链接元数据（轻量、单查询），拿到 fight/players 以构建完整日志
  const metaResult = await getWclReportMeta(pending.url);
  if (!metaResult.ok) {
    console.error("[enrich] 主链接元数据获取失败:", metaResult.code, metaResult.message);
    return NextResponse.json({ ok: false, error: metaResult.message }, { status: 502 });
  }
  const fight = selectFight(metaResult.meta.fights, pending.fightId);
  const fightPlayers = applyFightSpecs(
    filterPlayersByFight(metaResult.meta.players, fight?.friendlyPlayers ?? null),
    fight?.friendlyPlayers ?? null,
    fight?.friendlySpecs ?? null,
  );
  const player = fightPlayers.find((p) => p.id === pending.playerId);
  if (!fight || !player) {
    console.error("[enrich] 战斗/角色不再可解析:", { fightId: pending.fightId, playerId: pending.playerId });
    return NextResponse.json({ ok: false, error: "战斗数据已失效，请重新创建复盘" }, { status: 400 });
  }

  // 对比基准 + 事件并行拉取（各自失败降级，不阻塞）
  const comparePromise = pending.compareUrl ? getCompareBaseline(pending.compareUrl) : null;
  const eventsPromise = getFightEvents({
    code: metaResult.meta.code,
    region: pending.region,
    fightId: fight.id,
    playerId: player.id,
    fightStartMs: fight.startTime ?? 0,
    fightEndMs: fight.endTime ?? fight.durationSec * 1000,
    isMock: metaResult.meta.isMock === true,
  });

  let compareMeta: { url: string; title?: string; code?: string; note?: string } | null = null;
  try {
    const baseline = await comparePromise;
    if (baseline?.ok && pending.compareUrl) {
      compareMeta = {
        url: pending.compareUrl,
        title: baseline.meta.title,
        code: baseline.meta.code,
        note: `对比基准：${baseline.meta.fights
          .slice(0, 3)
          .map((f) => `${f.name} ${f.keystoneLevel}层 ${f.success ? "限时" : "超时"}`)
          .join("；")}`,
      };
    } else if (pending.compareUrl) {
      compareMeta = { url: pending.compareUrl, note: "对比基准获取失败，本场不含对比章节" };
    }
  } catch (err) {
    console.error("[enrich] 对比基准获取异常:", err);
    if (pending.compareUrl) compareMeta = { url: pending.compareUrl, note: "对比基准获取失败，本场不含对比章节" };
  }

  let log;
  let dataInsufficient = false;
  try {
    const eventsRes = await eventsPromise;
    if (eventsRes.events.length === 0) {
      log = buildPlaceholderLinkLog(fight, player, fightPlayers);
      dataInsufficient = true;
    } else {
      log = buildProcessedLogFromWcl({
        fight,
        player,
        players: fightPlayers,
        events: eventsRes.events,
        truncated: eventsRes.truncated,
      });
    }
  } catch (err) {
    console.error("[enrich] 事件拉取异常:", err);
    log = buildPlaceholderLinkLog(fight, player, fightPlayers);
    dataInsufficient = true;
  }

  await repo.saveProcessedLog({
    reportId: id,
    log,
    rawSize: 0,
    rawLines: 0,
    tokenEstimate: estimateProcessedLogTokens(log),
  });
  if (compareMeta) {
    await repo.updateReportCompareMeta(id, compareMeta);
  }

  console.log("[enrich] 完成:", {
    reportId: id,
    elapsedMs: Date.now() - startedAt,
    dataInsufficient,
    events: log.timeline.length,
  });
  return NextResponse.json({
    ok: true,
    dataInsufficient,
    compareDegraded: pending.compareUrl ? !compareMeta?.title : false,
  });
}
