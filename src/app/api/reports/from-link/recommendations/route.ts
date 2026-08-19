import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/provider";
import { getAccessToken, getWclReportMeta, parseWclUrl, selectFight } from "@/lib/wcl/adapter";
import { applyFightSpecs, filterPlayersByFight } from "@/lib/wcl/players";
import { buildCompProfile } from "@/lib/route/comp-profile";
import { dungeonPullsToFingerprint } from "@/lib/route/dungeon-pulls";
import { fetchReportPulls, recommendReferences } from "@/lib/wcl/rankings";

export const maxDuration = 30;

const bodySchema = z.object({
  url: z.string().trim().url("链接格式不正确"),
  fightId: z.number().int(),
  playerId: z.number().int(),
});

/**
 * POST /api/reports/from-link/recommendations —— 自动对比推荐（FR-3 对比 + FR-12）。
 * 输入用户已选定的战斗 + 复盘对象，输出"同副本、相近层数、阵容相近"的参考 log 列表
 * （路线/阵容相似度已排序）。推荐获取失败/无候选 → 静默返回空列表 + degradedReason，
 * 前端据此回退到"手动粘贴对比链接"（不阻塞复盘主流程）。
 */
export async function POST(req: NextRequest) {
  const res = NextResponse.json<{ ok: boolean }>({ ok: false });
  const user = await getCurrentUser(req, res);
  if (!user) {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "请求参数不完整" }, { status: 400 });
  }
  const { url, fightId, playerId } = parsed.data;

  const metaResult = await getWclReportMeta(url);
  if (!metaResult.ok) {
    return NextResponse.json({ ok: false, error: metaResult.message }, { status: 400 });
  }
  const meta = metaResult.meta;
  const fight = selectFight(meta.fights, fightId);
  if (!fight) {
    return NextResponse.json({ ok: false, error: "未找到该场战斗" }, { status: 400 });
  }
  const fightPlayers = applyFightSpecs(
    filterPlayersByFight(meta.players, fight.friendlyPlayers),
    fight.friendlyPlayers,
    fight.friendlySpecs,
  );
  const player = fightPlayers.find((p) => p.id === playerId);
  if (!player) {
    return NextResponse.json({ ok: false, error: "请选择有效的复盘对象" }, { status: 400 });
  }

  const region = parseWclUrl(url).region ?? "www";
  const isMock = meta.isMock === true;

  // 用户阵容画像（来自本场实际参与的玩家；mock 与真实路径均可用）
  const userComp = buildCompProfile(fightPlayers);

  // 用户路线指纹（来自用户报告 dungeonPulls，best-effort；失败则仅阵容相似度）
  let userRoute: ReturnType<typeof dungeonPullsToFingerprint> = null;
  if (!isMock) {
    try {
      const token = await getAccessToken(region);
      const pulls = await fetchReportPulls(region, token, meta.code, fight.id, {});
      userRoute = dungeonPullsToFingerprint(fight.name, pulls, {
        runStartMs: fight.startTime ?? 0,
        durationMs: Math.max(1000, fight.durationSec * 1000),
      });
    } catch {
      userRoute = null;
    }
  }

  const result = await recommendReferences({
    dungeon: fight.name,
    level: fight.keystoneLevel ?? 2,
    spec: player.spec,
    playerClass: player.class,
    region,
    userRoute,
    userComp,
    isMock,
  });

  return NextResponse.json({
    ok: true,
    isMock,
    candidates: result.candidates,
    degradedReason: result.degradedReason,
  });
}
