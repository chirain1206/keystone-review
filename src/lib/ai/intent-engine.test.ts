import { describe, expect, it } from "vitest";
import { runIntentEngine } from "@/lib/ai/intent-engine";
import type { Sample } from "@/lib/ai/intent-samples";
import { loadIntentSamples } from "@/lib/ai/intent-samples";

/**
 * T6 开发自测：意图引擎对样例集的判定。
 * 验收（tasks.md T6）：开发自测构造样例 ≥2 个通过 —— 此处全部 16 个样例
 * （10 意图 + 6 失误）逐一断言，QA 阶段再以真实模型跑 eval 脚本（≥80%）。
 */
describe("战术意图识别引擎（FR-5）", () => {
  const samples = loadIntentSamples();

  it("样例集规模达标：≥10 意图案例 + ≥5 失误案例", () => {
    expect(samples.length).toBeGreaterThanOrEqual(15);
    expect(samples.filter((s) => s.verdict === "intent").length).toBeGreaterThanOrEqual(10);
    expect(samples.filter((s) => s.verdict === "mistake").length).toBeGreaterThanOrEqual(5);
  });

  for (const s of samples) {
    it(`[${s.id}] ${s.title}`, () => {
      const verdicts = runIntentEngine({
        combat: s.combat,
        aggregate: s.aggregate,
      });
      const hit = verdicts.some(
        (v) => v.key === s.expectedKey && v.verdict === s.verdict,
      );
      expect(
        hit,
        `期望 ${s.expectedKey}/${s.verdict}，实得：${verdicts.map((v) => `${v.key}:${v.verdict}`).join(", ") || "无"}`,
      ).toBe(true);
    });
  }

  it("PRD 经典案例：5:36 药水不得出现在「可改进点」，必须归入意图识别并解释原因", () => {
    const s = samples.find((x) => x.id === "intent-01")!;
    const verdicts = runIntentEngine({ combat: s.combat, aggregate: s.aggregate });
    const intent = verdicts.find((v) => v.key === "potion-align-vulnerable");
    expect(intent?.verdict).toBe("intent");
    expect(intent?.explain).toContain("5:36");
    expect(intent?.explain).toContain("易伤");
    // 同一操作不得同时被判为失误
    expect(verdicts.some((v) => v.key === "potion-wasted")).toBe(false);
  });

  it("真实失误（爆发空转）不得误判为意图", () => {
    const s = samples.find((x) => x.id === "mistake-01")!;
    const verdicts = runIntentEngine({ combat: s.combat, aggregate: s.aggregate });
    expect(verdicts.some((v) => v.key === "wasted-burst" && v.verdict === "mistake")).toBe(true);
    expect(verdicts.filter((v) => v.verdict === "intent").some((v) => v.atSec === 100)).toBe(false);
  });
});
