import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/provider";
import { getRepo } from "@/lib/db";
import {
  getWclReportMeta,
  parseWclUrl,
  selectFight,
} from "@/lib/wcl/adapter";
import { applyFightSpecs, filterPlayersByFight, preselectPlayerId } from "@/lib/wcl/players";
import { buildPlaceholderLinkLog } from "@/lib/wcl/to-processed";
import type { EnrichPayload } from "@/lib/parser/schema";
import { estimateProcessedLogTokens } from "@/lib/ai/tokens";
import { enforceCreateLimits } from "@/lib/quota/enforce";
import { verifyTurnstile } from "@/lib/turnstile/adapter";
import { getClientIp } from "@/lib/net/client-ip";

// 两步式创建：本路由只做元数据校验 + 秒建报告；事件/对比在 enrich 路由独立完成
export const maxDuration = 30;

const bodySchema = z.object({
  url: z.string().trim().url("链接格式不正确"),
  compareUrl: z.string().trim().url("对比链接格式不正确").optional(),
  fightId: z.number().int().optional(),
  /** 复盘对象 = 报告内 actor id（角色列表点选）；缺省走预览模式（返回战斗 + 角色列表）。 */
  playerId: z.number().int().optional(),
  turnstileToken: z.string().optional(), // T9 人机验证
});

/**
 * POST /api/reports/from-link —— WCL 链接接入（FR-1/FR-3/FR-10，事件级数据）。
 * 两段式：
 *  1) 仅 url（预览）：返回大秘境战斗列表 + 参与角色列表（名字/职业/专精 + 上传者预选），不建报告、不扣每日额度；
 *  2) url + fightId + playerId（创建）：拉取所选玩家该场战斗的必要事件，转 FR-10 结构化数据后建报告。
 * 事件拉取失败/超配额 → 降级为仅元数据（报告标注"数据不足"，AI 如实回答）。
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const res = NextResponse.json<{ ok: boolean }>({ ok: false });
  const user = await getCurrentUser(req, res);
  if (!user) {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "请粘贴有效的 Warcraft Logs 报告链接" }, { status: 400 });
  }
  const { url, compareUrl, fightId, playerId, turnstileToken } = parsed.data;
  console.log("[from-link] 请求:", { mode: playerId === undefined ? "preview" : "create", url, fightId, playerId, hasCompare: Boolean(compareUrl) });

  // 主链接元数据（战斗 + 玩家列表 + 上传者）
  const metaResult = await getWclReportMeta(url);
  if (!metaResult.ok) {
    console.error("[from-link] 主链接元数据获取失败:", metaResult.code, metaResult.message, url);
    const status = metaResult.code === "FETCH_FAILED" ? 502 : 400;
    return NextResponse.json({ ok: false, code: metaResult.code, error: metaResult.message }, { status });
  }
  const fight = selectFight(metaResult.meta.fights, fightId);
  if (!fight) {
    return NextResponse.json(
      { ok: false, code: "NO_MYTHIC_FIGHT", error: "该报告中没有可分析的大秘境战斗" },
      { status: 400 },
    );
  }
  const isMock = metaResult.meta.isMock === true;
  const players = metaResult.meta.players;
  // 复盘对象按所选场次过滤 + 按场次覆盖专精（同一角色跨场次换专精时用本场的 friendlySpecs）
  const fightPlayers = applyFightSpecs(
    filterPlayersByFight(players, fight.friendlyPlayers),
    fight.friendlyPlayers,
    fight.friendlySpecs,
  );

  // ---------- 预览模式：返回战斗 + 角色列表（不扣每日额度） ----------
  if (playerId === undefined) {
    const tv = await verifyTurnstile(turnstileToken, getClientIp(req));
    if (!tv.ok) {
      return NextResponse.json({ ok: false, error: tv.error }, { status: 403 });
    }
    return NextResponse.json({
      ok: true,
      preview: true,
      isMock,
      fights: metaResult.meta.fights.map((f) => ({
        id: f.id,
        name: f.name,
        level: f.keystoneLevel,
        success: f.success,
        durationSec: f.durationSec,
        affixes: f.affixes,
        selected: f.selected === true,
        playerIds: f.friendlyPlayers ?? null,
        playerSpecs: f.friendlySpecs ?? null,
      })),
      players,
      selectedFightId: fight.id,
      selectedPlayerId: preselectPlayerId(fightPlayers, metaResult.meta.uploaderName),
      compareDegraded: false,
    });
  }

  // ---------- 创建模式：完整防护 → 秒建报告（两步式 FR-1） ----------
  // 事件/对比拉取耗时可达 60s+，不在本请求内同步执行：先存「占位日志 + 待补充标记」，
  // 报告页调用 POST /api/reports/:id/enrich 独立完成（各自 60s 额度，超时降级元数据）。
  const limited = await enforceCreateLimits(req, user.id, turnstileToken);
  if (limited) return limited;

  const player = fightPlayers.find((p) => p.id === playerId);
  if (!player) {
    console.error("[from-link] 复盘对象不在战斗玩家列表中:", { fightId, playerId });
    return NextResponse.json({ ok: false, error: "请选择有效的复盘对象" }, { status: 400 });
  }

  const region = parseWclUrl(url).region ?? "www";
  const enrich: EnrichPayload = {
    url,
    fightId: fight.id,
    playerId: player.id,
    region,
    ...(compareUrl ? { compareUrl } : {}),
  };
  const log = buildPlaceholderLinkLog(fight, player, fightPlayers, enrich);

  const repo = getRepo();
  const report = await repo.createReport({
    userId: user.id,
    sourceType: "link",
    dungeon: fight.name,
    level: fight.keystoneLevel ?? 2,
    spec: player.spec,
    playerName: player.name,
    playerClass: player.class,
    result: fight.success,
    compareMeta: null, // 对比基准由 enrich 拉取后写入
    mock: isMock,
  });
  await repo.saveProcessedLog({
    reportId: report.id,
    log,
    rawSize: 0,
    rawLines: 0,
    tokenEstimate: estimateProcessedLogTokens(log),
  });

  console.log("[from-link] 创建成功（待 enrich）:", { reportId: report.id, elapsedMs: Date.now() - startedAt });
  return NextResponse.json({
    ok: true,
    id: report.id,
    needsEnrich: true,
    fight: {
      name: fight.name,
      level: fight.keystoneLevel,
      success: fight.success,
      durationSec: fight.durationSec,
      affixes: fight.affixes,
    },
    player: { name: player.name, class: player.class, spec: player.spec },
  });
}
