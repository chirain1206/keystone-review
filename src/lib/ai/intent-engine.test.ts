import { describe, expect, it } from "vitest";
import {
  runIntentEngine,
  runKnowledgeIntentDetection,
  runSuspectedTechniqueDetection,
} from "@/lib/ai/intent-engine";
import type { Sample } from "@/lib/ai/intent-samples";
import { loadIntentSamples } from "@/lib/ai/intent-samples";

/**
 * 意图引擎样例集评测（T6 + T17 + T19 统一口径）。
 * 检测管线：
 *   - 规则引擎（时间轴可推理型意图 + 失误）
 *   - 知识辅助判定（kbFixtures 注入后识别领域知识依赖型意图）
 *   - 疑似高阶技巧（知识解释不了、证据链完整的异常操作）
 * 样例分类：
 *   - verdict intent/mistake 且无 kbFixtures → 规则引擎单测
 *   - verdict intent 且有 kbFixtures → 知识注入后检测（FR-11）
 *   - verdict suspected → 疑似判定（T19）
 */
describe("战术意图识别引擎（FR-5 + FR-11 + T19）", () => {
  const samples = loadIntentSamples();

  function detect(s: Sample, withKnowledge: boolean) {
    const input = { combat: s.combat, aggregate: s.aggregate };
    const knowledge = withKnowledge
      ? runKnowledgeIntentDetection(input, s.kbFixtures ?? [])
      : [];
    const engine = runIntentEngine(input);
    const suspected = runSuspectedTechniqueDetection(input, knowledge);
    return [...engine, ...knowledge, ...suspected];
  }

  it("样例集规模达标：≥10 意图 + ≥5 失误 + ≥5 知识依赖型 + 疑似案例", () => {
    expect(samples.length).toBeGreaterThanOrEqual(21);
    expect(samples.filter((s) => s.verdict === "intent").length).toBeGreaterThanOrEqual(15);
    expect(samples.filter((s) => s.verdict === "mistake").length).toBeGreaterThanOrEqual(5);
    expect(samples.filter((s) => (s.kbFixtures?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(5);
    expect(samples.filter((s) => s.verdict === "suspected").length).toBeGreaterThanOrEqual(1);
  });

  // 规则引擎样例（无知识依赖）：引擎单独判定
  for (const s of samples.filter((x) => !x.kbFixtures?.length && x.verdict !== "suspected")) {
    it(`[${s.id}] ${s.title}`, () => {
      const verdicts = runIntentEngine({ combat: s.combat, aggregate: s.aggregate });
      const hit = verdicts.some((v) => v.key === s.expectedKey && v.verdict === s.verdict);
      expect(
        hit,
        `期望 ${s.expectedKey}/${s.verdict}，实得：${verdicts.map((v) => `${v.key}:${v.verdict}`).join(", ") || "无"}`,
      ).toBe(true);
    });
  }

  // 知识依赖型样例（FR-11）：注入知识后检测；无知识时不得检出期望意图
  for (const s of samples.filter((x) => (x.kbFixtures?.length ?? 0) > 0)) {
    it(`[${s.id}] ${s.title}（知识注入后识别）`, () => {
      const input = { combat: s.combat, aggregate: s.aggregate };
      const knowledge = runKnowledgeIntentDetection(input, s.kbFixtures ?? []);
      const hit = knowledge.some((v) => v.key === s.expectedKey && v.verdict === "intent");
      expect(
        hit,
        `期望 ${s.expectedKey}/intent，实得：${knowledge.map((v) => v.key).join(", ") || "无"}`,
      ).toBe(true);
      // 无知识时不检出（这正是"领域知识依赖型"的含义）
      const without = detect(s, false);
      expect(without.some((v) => v.key === s.expectedKey && v.verdict === "intent")).toBe(false);
    });
  }

  // 疑似高阶技巧样例（T19）
  for (const s of samples.filter((x) => x.verdict === "suspected")) {
    it(`[${s.id}] ${s.title}（判疑似而非失误）`, () => {
      const input = { combat: s.combat, aggregate: s.aggregate };
      const engine = runIntentEngine(input);
      const suspected = runSuspectedTechniqueDetection(input, []);
      expect(suspected.some((v) => v.key === s.expectedKey && v.verdict === "suspected")).toBe(true);
      // 不武断判失误：疑似事件所在时间窗内不得出现失误判定
      const atSec = suspected[0]?.atSec ?? 0;
      const mistakesNear = engine.filter(
        (v) => v.verdict === "mistake" && v.atSec !== undefined && Math.abs(v.atSec - atSec) <= 30,
      );
      expect(mistakesNear).toEqual([]);
    });
  }

  it("PRD 经典案例：5:36 药水不得出现在「可改进点」，必须归入意图识别并解释原因", () => {
    const s = samples.find((x) => x.id === "intent-01")!;
    const verdicts = runIntentEngine({ combat: s.combat, aggregate: s.aggregate });
    const intent = verdicts.find((v) => v.key === "potion-align-vulnerable");
    expect(intent?.verdict).toBe("intent");
    expect(intent?.explain).toContain("5:36");
    expect(intent?.explain).toContain("易伤");
    expect(verdicts.some((v) => v.key === "potion-wasted")).toBe(false);
  });

  it("真实失误（爆发空转）不得误判为意图", () => {
    const s = samples.find((x) => x.id === "mistake-01")!;
    const verdicts = runIntentEngine({ combat: s.combat, aggregate: s.aggregate });
    expect(verdicts.some((v) => v.key === "wasted-burst" && v.verdict === "mistake")).toBe(true);
    expect(verdicts.filter((v) => v.verdict === "intent").some((v) => v.atSec === 100)).toBe(false);
  });
});
