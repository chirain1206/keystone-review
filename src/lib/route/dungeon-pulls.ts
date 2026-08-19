import type { NpcGroup, RouteFingerprint, WaveSignature } from "@/lib/route/fingerprint";

/**
 * WCL ReportDungeonPull → 路线指纹（RouteFingerprint）纯转换（FR-12 / 自动对比推荐）。
 *
 * 与 lib/parser/tactical-pulls.ts 的产物兼容：两边都产出"波序列"，
 * 每波 = 怪物签名（NPC 名 + 数量）+ kind（trash/boss）。
 *
 * WCL pull 分段已把 chain 接波合并（战斗未中断即视为一个 pull），波次边界与
 * 自解析原始 log 的"战术波"不同；但"自动对比推荐"场景下，候选与用户报告若都来自
 * WCL 链接路径，则失真一致，用同一套指纹比较仍有效（见 TECH-DESIGN ADR-003）。
 *
 * 字段名已对照 WCL v2 schema 核实（github.com/math280h/go-wcl schema.graphql）：
 *  - Report.dungeonPulls: [ReportDungeonPull]
 *  - ReportDungeonPull { id, name, encounterID, kill, startTime, endTime, enemyNPCs, … }
 *    （encounterID 为 0 = trash 战斗；否则为 boss）
 *  - ReportDungeonPullNPC { id, gameID, … }（无 name 字段，名称需另经 gameData.npc 解析）
 */

export interface DungeonPullNpc {
  /** WCL actor gameID（游戏内 NPC id，用于跨报告稳定签名）。 */
  gameId: number | null;
  /** 已解析的 NPC 名（gameData.npc 解析后回填）；无名称的 NPC 不参与签名。 */
  name: string | null;
}

export interface DungeonPull {
  id: number;
  name: string;
  /** 0 = trash 战斗；非 0 = boss 战斗。 */
  encounterID: number;
  /** 相对报告起点的毫秒时间戳（与 ReportFight.startTime 同基准）。 */
  startTime: number;
  endTime: number;
  npcs: DungeonPullNpc[];
}

export interface DungeonPullsFingerprintOptions {
  /** 该场大秘境整场战斗的开始时间（相对报告起点毫秒）。 */
  runStartMs: number;
  /** 该场大秘境整场战斗的时长（毫秒）。 */
  durationMs: number;
}

/**
 * 把 WCL dungeonPulls 转成 RouteFingerprint（与 buildRouteFingerprint 产物结构一致）。
 * - 无 pull 或全部 pull 都无可签名 NPC 时返回 null（调用方降级为"无路线数据"）。
 * - relTime 用 (pull.startTime - runStartMs) / durationMs 归一化到 [0,1]。
 * - kind = encounterID === 0 ? "trash" : "boss"；bossAnchor 为该波之前出现的 boss 波数。
 */
export function dungeonPullsToFingerprint(
  dungeon: string,
  pulls: DungeonPull[],
  opts: DungeonPullsFingerprintOptions,
): RouteFingerprint | null {
  if (pulls.length === 0) return null;

  const duration = Math.max(1, opts.durationMs);
  const waves: WaveSignature[] = [];
  let bossSeen = 0;

  for (const pull of pulls) {
    const npcMap = new Map<string, NpcGroup>();
    for (const npc of pull.npcs) {
      const name = npc.name?.trim();
      if (!name) continue;
      const g = npcMap.get(name) ?? { name, npcId: npc.gameId, count: 0 };
      g.count++;
      npcMap.set(name, g);
    }
    const kind: WaveSignature["kind"] = pull.encounterID === 0 ? "trash" : "boss";
    const relTime = (pull.startTime - opts.runStartMs) / duration;
    waves.push({
      npcs: [...npcMap.values()],
      kind,
      bossAnchor: bossSeen,
      relTime: Math.min(1, Math.max(0, relTime)),
    });
    if (kind === "boss") bossSeen++;
  }

  // 无任何可签名 NPC（全部 NPC 名缺失）→ 视为无路线数据
  if (waves.every((w) => w.npcs.length === 0)) return null;

  return {
    dungeon,
    waves,
    trashWaves: waves.filter((w) => w.kind === "trash"),
    bossCount: bossSeen,
  };
}
