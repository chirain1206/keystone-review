import { describe, expect, it } from "vitest";
import type { TacticalPull, TacticalRun } from "@/lib/parser/tactical-pulls";
import {
  buildRouteFingerprint,
  routeDiff,
  routeSimilarity,
  SAME_ROUTE_THRESHOLD,
} from "@/lib/route/fingerprint";
import {
  buildCompProfile,
  compSimilarity,
  COMP_SIMILAR_THRESHOLD,
} from "@/lib/route/comp-profile";

/**
 * T22 验收（FR-12 路线指纹 + 阵容画像）：
 *  - 同路线不同波次边界 → 高相似（≥ 阈值）
 *  - 阵容相似（可替换职业）→ 高相似
 *  - 法刀大波 vs 菜刀短平快 → 低相似
 *  - 差异清单正确（多/少哪波、顺序差异）
 */

function wave(names: string[], kind: "trash" | "boss" = "trash"): TacticalPull {
  return {
    index: 0,
    npcs: names.map((name, i) => ({
      guid: `Creature-0-1-2-3-${1000 + i}`,
      name,
      npcId: 1000 + i,
      kind,
    })),
    startMs: 0,
    endMs: 0,
    startSec: 0,
    endSec: 0,
    chainFromPrev: false,
    kind,
  };
}

function run(dungeon: string, pulls: TacticalPull[]): TacticalRun {
  return {
    dungeon,
    level: 15,
    runStartMs: 0,
    runEndMs: 100_000,
    durationSec: 100,
    pulls,
  };
}

const fp = (dungeon: string, pulls: TacticalPull[]) => buildRouteFingerprint(run(dungeon, pulls));

describe("路线指纹与相似度（T22）", () => {
  it("同路线不同波次边界（合波 vs 拆波）→ 高相似", () => {
    const merged = fp("A", [wave(["Pack Alpha", "Pack Alpha", "Devourer", "Devourer"])]);
    const split = fp("B", [wave(["Pack Alpha", "Pack Alpha"]), wave(["Devourer", "Devourer"])]);
    const sim = routeSimilarity(merged, split);
    expect(sim).toBeGreaterThanOrEqual(SAME_ROUTE_THRESHOLD);
    expect(sim).toBeCloseTo(1, 5); // 内容与压平顺序完全一致
  });

  it("同类怪数量小差异（2× vs 3×）→ 高相似", () => {
    const a = fp("A", [wave(["Pack Alpha", "Pack Alpha"])]);
    const b = fp("B", [wave(["Pack Alpha", "Pack Alpha", "Pack Alpha"])]);
    expect(routeSimilarity(a, b)).toBeGreaterThanOrEqual(SAME_ROUTE_THRESHOLD);
  });

  it("法刀大波 vs 菜刀短平快（不同怪物集）→ 低相似", () => {
    const casterBig = fp("A", [
      wave(["Devourer", "Devourer", "Devourer"]),
      wave(["Guardian", "Guardian"]),
    ]);
    const meleeQuick = fp("B", [
      wave(["Pack Alpha"]),
      wave(["Stalker"]),
      wave(["Hound"]),
    ]);
    expect(routeSimilarity(casterBig, meleeQuick)).toBeLessThan(SAME_ROUTE_THRESHOLD);
  });

  it("差异清单：多/少哪波正确", () => {
    const a = fp("A", [wave(["Pack Alpha", "Pack Alpha"]), wave(["Devourer", "Devourer"])]);
    const b = fp("B", [wave(["Pack Alpha", "Pack Alpha"])]);
    const diff = routeDiff(a, b);
    expect(diff.entries.some((e) => e.kind === "extra-a" && e.aWave === 2)).toBe(true);
    expect(diff.entries.some((e) => e.kind === "extra-b")).toBe(false);
    expect(diff.summary).toContain("差异");
  });

  it("差异清单：顺序差异被识别", () => {
    const a = fp("A", [wave(["Pack Alpha"]), wave(["Devourer"])]);
    const b = fp("B", [wave(["Devourer"]), wave(["Pack Alpha"])]);
    const diff = routeDiff(a, b);
    expect(diff.entries.some((e) => e.kind === "order")).toBe(true);
    expect(diff.entries.some((e) => e.kind === "composition")).toBe(true);
  });
});

describe("阵容画像与相似度（T22）", () => {
  const meleeA = buildCompProfile([
    { class: "Demon Hunter" },
    { class: "Monk" },
    { class: "Warrior" },
    { class: "Rogue" },
    { class: "Death Knight" },
  ]);
  const meleeB = buildCompProfile([
    { class: "Demon Hunter" },
    { class: "Monk" },
    { class: "Warrior" },
    { class: "Paladin" }, // 近战可替换：Rogue → Paladin（同定位）
    { class: "Death Knight" },
  ]);
  const caster = buildCompProfile([
    { class: "Mage" },
    { class: "Warlock" },
    { class: "Priest" },
    { class: "Shaman" },
    { class: "Evoker" },
  ]);

  it("阵容相似（可替换职业互换）→ 高相似", () => {
    expect(compSimilarity(meleeA, meleeB)).toBeGreaterThanOrEqual(COMP_SIMILAR_THRESHOLD);
  });

  it("法刀 vs 菜刀 → 低相似", () => {
    expect(compSimilarity(caster, meleeA)).toBeLessThan(COMP_SIMILAR_THRESHOLD);
  });

  it("粗标签仅辅助：法刀 / 菜刀 正确归类", () => {
    expect(meleeA.tag).toBe("菜刀");
    expect(caster.tag).toBe("法刀");
  });

  it("未知职业不参与画像（不误判）", () => {
    const empty = buildCompProfile([{ class: "Unknown" }]);
    expect(empty.classes).toEqual([]);
    expect(empty.meleeCount).toBe(0);
    expect(empty.rangedCount).toBe(0);
  });
});
