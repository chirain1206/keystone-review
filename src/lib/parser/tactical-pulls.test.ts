import { describe, expect, it } from "vitest";
import { detectTacticalPulls, NEAR_DEATH_RATIO } from "@/lib/parser/tactical-pulls";

/**
 * T21 验收（chain 波次还原，FR-12）：
 *  - chain 样例（两波被打断后接上合成一波）正确拆回两波
 *  - 纯单波样例不误拆
 *  - BOSS 自成一波（作为时间锚点）
 *  - 与 FR-10 结构化数据独立（按需计算，不占 token 预算）
 */

function ts(offsetSec: number): string {
  const total = Math.floor(offsetSec);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const ms = Math.round((offsetSec - total) * 1000);
  return `5/16 ${String(21 + hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

const PLAYER = '"Player-970-00000001"';
const PLAYER_NAME = '"Mymage"';

function mob(npcId: number): string {
  return `"Creature-0-3764-1822-28780-${npcId}"`;
}

function damage(offsetSec: number, dst: string, dstName: string, amount: number): string {
  return `${ts(offsetSec)}  COMBAT_LOG_EVENT,SPELL_DAMAGE,${PLAYER},${PLAYER_NAME},0x508,0x0,${dst},${dstName},0xa48,0x0,1,"Fireball",4,${amount},0,0,0,1,0,0,0,0`;
}

function died(offsetSec: number, victim: string, victimName: string): string {
  return `${ts(offsetSec)}  COMBAT_LOG_EVENT,UNIT_DIED,${PLAYER},${PLAYER_NAME},0x508,0x0,${victim},${victimName},0xa48,0x0`;
}

function wrap(dungeon: string, level: number, endSec: number, body: string[]): string {
  return [
    `${ts(0)}  COMBAT_LOG_EVENT,MAP_CHANGE,"${dungeon}","${dungeon}",2222`,
    `${ts(0)}  COMBAT_LOG_EVENT,CHALLENGE_MODE_START,"${dungeon}",${level},10,124,134`,
    ...body,
    `${ts(endSec)}  COMBAT_LOG_EVENT,CHALLENGE_MODE_END,"${dungeon}",${level},1`,
  ].join("\n");
}

describe("战术波还原（T21）", () => {
  it("chain 样例：两波被打断后接上合成一波 → 拆回两波", () => {
    // 波 1：Pack Alpha ×2（1.0s / 1.5s 进入战斗），8.0/8.2s 死亡；
    // 波 2：Devourer ×2 在 8.5/9.0s 进入战斗（此时波 1 已全灭 → chain 接波）
    const body = [
      damage(1.0, mob(1001), '"Pack Alpha"', 5000),
      damage(1.5, mob(1002), '"Pack Alpha"', 5000),
      died(8.0, mob(1001), '"Pack Alpha"'),
      died(8.2, mob(1002), '"Pack Alpha"'),
      damage(8.5, mob(2001), '"Devourer"', 5000),
      damage(9.0, mob(2002), '"Devourer"', 5000),
      died(12.0, mob(2001), '"Devourer"'),
      died(12.0, mob(2002), '"Devourer"'),
    ];
    const r = detectTacticalPulls(wrap("Mists of Tirna Scithe", 15, 13, body));
    expect(r.ok).toBe(true);
    expect(r.runs).toHaveLength(1);

    const pulls = r.runs[0].pulls;
    expect(pulls.length).toBe(2);
    expect(pulls[0].npcs.map((n) => n.name)).toEqual(["Pack Alpha", "Pack Alpha"]);
    expect(pulls[1].npcs.map((n) => n.name)).toEqual(["Devourer", "Devourer"]);
    expect(pulls[1].chainFromPrev).toBe(true);
    expect(pulls[0].chainFromPrev).toBe(false);
    // 起止时间（相对战斗开始）
    expect(pulls[0].startSec).toBe(1);
    expect(pulls[1].startSec).toBe(8.5);
  });

  it("纯单波样例不误拆（多怪同时进入战斗仍为同一波）", () => {
    const body = [
      damage(1.0, mob(3001), '"Pack Alpha"', 5000),
      damage(1.5, mob(3002), '"Pack Alpha"', 5000),
      damage(2.0, mob(3003), '"Pack Alpha"', 5000),
      died(10.0, mob(3001), '"Pack Alpha"'),
      died(10.0, mob(3002), '"Pack Alpha"'),
      died(10.0, mob(3003), '"Pack Alpha"'),
    ];
    const r = detectTacticalPulls(wrap("Grim Batol", 12, 11, body));
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].pulls.length).toBe(1);
    expect(r.runs[0].pulls[0].npcs.length).toBe(3);
  });

  it("BOSS 自成一波（ENCOUNTER_START 标记）", () => {
    const body = [
      `${ts(0.1)}  COMBAT_LOG_EVENT,ENCOUNTER_START,1,"Mistcaller",8,5`,
      damage(1.0, mob(9001), '"Mistcaller"', 5000),
      damage(1.5, mob(9002), '"Pack Alpha"', 5000),
      died(9.0, mob(9002), '"Pack Alpha"'),
      died(11.0, mob(9001), '"Mistcaller"'),
    ];
    const r = detectTacticalPulls(wrap("Mists of Tirna Scithe", 15, 12, body));
    const pulls = r.runs[0].pulls;
    // BOSS 先进入战斗 → 第一波即 boss，随后 trash 自成一波
    expect(pulls.some((p) => p.kind === "boss")).toBe(true);
    const bossPull = pulls.find((p) => p.kind === "boss")!;
    expect(bossPull.npcs[0].name).toBe("Mistcaller");
  });

  it("chain 阈值常量可读（供下游指纹/分组复用）", () => {
    expect(NEAR_DEATH_RATIO).toBeGreaterThan(0);
    expect(NEAR_DEATH_RATIO).toBeLessThanOrEqual(1);
  });
});
