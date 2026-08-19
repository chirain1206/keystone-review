import { describe, expect, it } from "vitest";
import { buildProcessedLogFromWcl } from "@/lib/wcl/to-processed";
import { mockPlayers } from "@/lib/wcl/players";
import type { WclFight } from "@/lib/wcl/adapter";
import type { WclPlayer } from "@/lib/wcl/players";
import type { WclRawEvent } from "@/lib/wcl/events";
import { estimateProcessedLogTokens, TOKEN_BUDGET_PER_COMBAT } from "@/lib/ai/tokens";

/**
 * WCL 事件 → FR-10 转换验收：
 *  - 时间戳对齐（report 相对毫秒 → 战斗内秒，减 fight.startTime）
 *  - 类型映射（cast/interrupt/death/applybuff/removebuff → cooldowns/interrupts/deaths/vulnerablePhases）
 *  - token 预算内
 */

const fight: WclFight = {
  id: 7,
  name: "Mists of Tirna Scithe",
  difficulty: 8,
  keystoneLevel: 15,
  affixes: ["10"],
  success: true,
  durationSec: 1650,
  startTime: 60_000,
  endTime: 1_710_000,
  playerName: "DemoMage",
  playerClass: "Mage",
  playerSpec: "Fire",
};

const players = mockPlayers();
const player: WclPlayer = players.find((p) => p.id === 3)!; // DemoMage

const at = (t: number) => 60_000 + t * 1000;

function events(): WclRawEvent[] {
  return [
    { timestamp: at(10), type: "cast", sourceID: 3, targetID: 99, ability: { name: "Fireball", guid: 133 } },
    { timestamp: at(100), type: "cast", sourceID: 3, targetID: 99, ability: { name: "Combustion", guid: 190319 } },
    { timestamp: at(100), type: "applybuff", sourceID: 3, targetID: 3, ability: { name: "Combustion", guid: 190319 } },
    { timestamp: at(112), type: "removebuff", sourceID: 3, targetID: 3, ability: { name: "Combustion", guid: 190319 } },
    { timestamp: at(336), type: "cast", sourceID: 3, targetID: 3, ability: { name: "Potion of the Frozen Focus", guid: 371033 } },
    { timestamp: at(200), type: "interrupt", sourceID: 3, targetID: 88, ability: { name: "Counterspell", guid: 2139 }, extraAbility: { name: "Bewildering Pollen", guid: 205749 } },
    { timestamp: at(500), type: "death", sourceID: 88, targetID: 3, ability: { name: "Bewildering Pollen", guid: 205749 }, source: { name: "Mistcaller", id: 88 }, target: { name: "DemoMage", id: 3 } },
    { timestamp: at(600), type: "applybuff", sourceID: 3, targetID: 999, ability: { name: "Vulnerable", guid: 1 }, target: { name: "Mistcaller", id: 999 } },
    { timestamp: at(615), type: "removebuff", sourceID: 3, targetID: 999, ability: { name: "Vulnerable", guid: 1 }, target: { name: "Mistcaller", id: 999 } },
  ];
}

describe("事件 → FR-10 转换", () => {
  it("时间戳对齐：report 相对毫秒 → 战斗内秒（减 fight.startTime）", () => {
    const log = buildProcessedLogFromWcl({ fight, player, players, events: events() });
    const potion = log.aggregate.cooldowns.find((c) => c.spell?.toLowerCase().includes("potion"))!;
    expect(potion).toBeDefined();
    expect(potion.t).toBe(336); // (396000 - 60000)/1000
    expect(potion.note).toContain("药水");
  });

  it("类型映射：打断 → interrupts（extraAbility 为被断技能）", () => {
    const log = buildProcessedLogFromWcl({ fight, player, players, events: events() });
    expect(log.aggregate.interrupts.length).toBe(1);
    const it = log.aggregate.interrupts[0];
    expect(it.spell).toBe("Bewildering Pollen");
    expect(it.t).toBe(200);
    expect(it.note).toBe("打断成功");
  });

  it("类型映射：死亡 → deaths（actor=所选玩家）", () => {
    const log = buildProcessedLogFromWcl({ fight, player, players, events: events() });
    expect(log.aggregate.deaths.length).toBe(1);
    expect(log.aggregate.deaths[0].actor).toBe("DemoMage");
    expect(log.aggregate.deaths[0].t).toBe(500);
    expect(log.aggregate.deaths[0].note).toBe("玩家死亡");
  });

  it("类型映射：爆发/CD → cooldowns（增益与施放按 spell@t 去重，增益优先）", () => {
    const log = buildProcessedLogFromWcl({ fight, player, players, events: events() });
    const combustion = log.aggregate.cooldowns.filter((c) => c.spell === "Combustion");
    // 施放 + applybuff 去重为 1 条（增益版本），removebuff 单独 1 条
    expect(combustion.length).toBe(2);
    expect(combustion.some((c) => c.type === "buff" && c.note === "获得增益")).toBe(true);
    expect(combustion.some((c) => c.note === "增益结束")).toBe(true);
  });

  it("类型映射：敌方易伤光环 → vulnerablePhases（apply→remove 配对）", () => {
    const log = buildProcessedLogFromWcl({ fight, player, players, events: events() });
    expect(log.aggregate.vulnerablePhases.length).toBe(1);
    expect(log.aggregate.vulnerablePhases[0].note).toBe("Vulnerable");
    expect(log.aggregate.vulnerablePhases[0].start).toBe(600);
    expect(log.aggregate.vulnerablePhases[0].end).toBe(615);
  });

  it("分钟级聚合：普通施放按分钟计数", () => {
    const log = buildProcessedLogFromWcl({ fight, player, players, events: events() });
    expect(log.aggregate.perMinute.length).toBeGreaterThan(0);
    const m0 = log.aggregate.perMinute.find((b) => b.minute === 0);
    expect(m0).toBeDefined();
    expect(m0!.casts?.find((c) => c.spell === "Fireball")?.count).toBe(1);
  });

  it("combat 元数据写入真实角色（非占位符）", () => {
    const log = buildProcessedLogFromWcl({ fight, player, players, events: events() });
    expect(log.combat.playerName).toBe("DemoMage");
    expect(log.combat.playerClass).toBe("Mage");
    expect(log.combat.playerSpec).toBe("Fire");
    expect(log.combat.players.length).toBe(5);
  });

  it("时间线按 t 排序且含 boss_phase", () => {
    const log = buildProcessedLogFromWcl({ fight, player, players, events: events() });
    for (let i = 1; i < log.timeline.length; i++) {
      expect(log.timeline[i].t).toBeGreaterThanOrEqual(log.timeline[i - 1].t);
    }
    expect(log.timeline.some((e) => e.type === "boss_phase")).toBe(true);
  });

  it("事件为空（降级）仍产出有效 ProcessedLog 且 token 预算内", () => {
    const log = buildProcessedLogFromWcl({ fight, player, players, events: [] });
    expect(log.aggregate.cooldowns.length).toBe(0);
    expect(log.aggregate.interrupts.length).toBe(0);
    expect(log.combat.playerName).toBe("DemoMage");
    expect(estimateProcessedLogTokens(log)).toBeLessThanOrEqual(TOKEN_BUDGET_PER_COMBAT);
  });

  it("token 预算 ≤50K", () => {
    const log = buildProcessedLogFromWcl({ fight, player, players, events: events() });
    expect(estimateProcessedLogTokens(log)).toBeLessThanOrEqual(TOKEN_BUDGET_PER_COMBAT);
  });
});
