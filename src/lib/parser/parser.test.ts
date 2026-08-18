import { describe, expect, it } from "vitest";
import {
  buildMythicRunLines,
  invalidSample,
  mplusSample,
  mplusTwoRunsSample,
  noRunsSample,
  raidOnlySample,
} from "@/lib/parser/samples";
import { parseCombatLog, toProcessedLog } from "@/lib/parser/parser";
import { parseLine } from "@/lib/parser/format";
import { TOKEN_BUDGET_PER_COMBAT, estimateProcessedLogTokens, estimateTokens } from "@/lib/ai/tokens";

/**
 * T4 验收（FR-2 / FR-10）：
 *  - 正确列出大秘境战斗（副本/层数/时间/专精）
 *  - 结构化数据 ≤50K token/场，且相对原始缩减 ≥90%（大文件样例）
 *  - 时间戳与原始一致
 *  - 非日志文件明确报错；团本文件明确提示
 *  - 噪声事件不进结构化数据
 */

describe("格式层（format.ts）", () => {
  it("解析标准行并保留原始时间戳", () => {
    const line = `5/16 21:05:36.120  COMBAT_LOG_EVENT,SPELL_CAST_SUCCESS,"Player-970-1","Mymage",0x511,0x0,"Creature-0-1","Mistcaller",0xa48,0x0,133,"Fireball",4`;
    const ev = parseLine(line);
    expect(ev).not.toBeNull();
    expect(ev!.ts).toBe("5/16 21:05:36.120");
    expect(ev!.event).toBe("SPELL_CAST_SUCCESS");
    expect(ev!.params[1]).toBe("Mymage");
    expect(ev!.params[9]).toBe("Fireball");
  });
});

describe("大秘境战斗识别（FR-2）", () => {
  it("单场样例：列出副本/层数/时长/成败", () => {
    const r = parseCombatLog(mplusSample());
    expect(r.ok).toBe(true);
    expect(r.runs!.length).toBe(1);
    const run = r.runs![0];
    expect(run.combat.dungeon).toBe("Mists of Tirna Scithe");
    expect(run.combat.level).toBe(15);
    expect(run.combat.success).toBe(true);
    expect(run.combat.durationSec).toBeGreaterThan(600);
    expect(run.affixes).toContain(10);
  });

  it("两场样例：战斗列表两场、按时间排序", () => {
    const r = parseCombatLog(mplusTwoRunsSample());
    expect(r.ok).toBe(true);
    expect(r.runs!.length).toBe(2);
    expect(r.runs![0].combat.dungeon).toBe("Mists of Tirna Scithe");
    expect(r.runs![1].combat.dungeon).toBe("Grim Batol");
    expect(r.runs![1].combat.level).toBe(12);
    expect(r.runs![1].combat.success).toBe(false);
  });

  it("团本文件 → 明确提示不支持团本", () => {
    const r = parseCombatLog(raidOnlySample());
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("NO_MYTHIC_RUNS");
    expect(r.error?.message).toContain("团本");
  });

  it("非日志文件 → 明确提示无效", () => {
    const r = parseCombatLog(invalidSample());
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("INVALID_FILE");
    expect(r.error?.message).toContain("不是有效的战斗日志");
  });

  it("有效格式但无战斗 → 提示无记录", () => {
    const r = parseCombatLog(noRunsSample());
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("NO_RUNS");
  });
});

describe("FR-10 预处理与降噪", () => {
  it("关键事件提取：打断/死亡/爆发药水/易伤阶段", () => {
    const r = parseCombatLog(mplusSample());
    const run = r.runs![0];

    // 打断（含被断技能名）
    const interrupts = run.aggregate.interrupts;
    expect(interrupts.length).toBe(3);
    expect(interrupts[0].spell).toBe("Bewildering Pollen");

    // 死亡
    const deaths = run.aggregate.deaths;
    expect(deaths.some((d) => d.actor === "Mymage")).toBe(true);

    // 5:36 喝爆发药水（FR-5 样例关键点），t=336
    const potion = run.aggregate.cooldowns.find((c) => c.spell?.includes("Potion"));
    expect(potion).toBeDefined();
    expect(potion!.t).toBe(336);
    expect(potion!.note).toContain("药水");

    // 易伤窗口
    const vuln = run.aggregate.vulnerablePhases;
    expect(vuln.length).toBe(1);
    expect(vuln[0].note).toBe("Vulnerable");
    expect(vuln[0].start).toBe(636);

    // 职业识别（Mage 来自 flags 0x511 → 职业 id 0x11=17? → 兼容解析）
    const mage = run.combat.players.find((p) => p.name === "Mymage");
    expect(mage).toBeDefined();
    expect(mage!.class).not.toBe("Unknown");
    // 复盘对象 = 施放最频繁的玩家
    expect(run.combat.playerName).toBe("Mymage");
  });

  it("噪声事件（环境伤害/无关单位）不进结构化数据", () => {
    const r = parseCombatLog(mplusSample());
    const run = r.runs![0];
    const all = JSON.stringify([run.timeline, run.aggregate]);
    expect(all).not.toContain("Rotting Spores");
    expect(all).not.toContain("Ambient");
    expect(run.aggregate.cooldowns.every((c) => c.actor !== "Spore")).toBe(true);
  });

  it("时间戳与原始 log 一致（ts 字符串保留）", () => {
    const r = parseCombatLog(mplusSample());
    const run = r.runs![0];
    const potion = run.aggregate.cooldowns.find((c) => c.spell?.includes("Potion"))!;
    // t=336 → 5/16 21:05:36.000
    expect(potion.ts).toBe("5/16 21:05:36.000");
  });

  it("大文件样例：token ≤50K 且缩减 ≥90%", () => {
    // 构造 ~1.2MB 噪声文件（相当于真实大 log 的压缩版）
    const noise = Array.from({ length: 3000 }, (_, i) =>
      `5/16 21:${String((i % 50) + 1).padStart(2, "0")}:00.000  COMBAT_LOG_EVENT,SPELL_DAMAGE,"Creature-0-3764-1-999","Spore",0xa48,0x0,"Player-970-1","Mymage",0x511,0x0,1,"Rotting Spores",8,${i * 13},0,0,0,0,0,0,0,0`,
    ).join("\n");
    const core = buildMythicRunLines(720 * 60 + 10, "Ara-Kara, City of Echoes", 18, true, true).join("\n");
    const big = noise + "\n" + core + "\n" + noise;
    const rawChars = big.length;

    const r = parseCombatLog(big);
    expect(r.ok).toBe(true);
    const processed = toProcessedLog(r.runs![0], "file");
    const tokens = estimateProcessedLogTokens([{ ...processed }]);
    expect(tokens).toBeLessThanOrEqual(TOKEN_BUDGET_PER_COMBAT);
    expect(r.stats!.tokenEstimate).toBeLessThanOrEqual(TOKEN_BUDGET_PER_COMBAT);
    // 缩减率（辅助指标）
    expect(r.stats!.reductionRatio).toBeGreaterThanOrEqual(0.9);
    expect(rawChars).toBeGreaterThan(1_000_000); // 确认是大样例
  });

  it("token 口径：1 token ≈ 3 字符（PRD FR-10 口径）", () => {
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("x".repeat(150_000))).toBe(50_000);
  });
});
