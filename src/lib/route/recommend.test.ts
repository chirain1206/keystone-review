import { describe, expect, it } from "vitest";
import type { TacticalPull, TacticalRun } from "@/lib/parser/tactical-pulls";
import { buildRouteFingerprint } from "@/lib/route/fingerprint";
import { buildCompProfile } from "@/lib/route/comp-profile";
import { compareReference, rankReferences, type ReferenceProfile } from "@/lib/route/recommend";
import { groupByRoute } from "@/lib/route/grouping";

/**
 * T23 验收（FR-12 落地）：
 *  - 推荐排序按相似度正确
 *  - 挖掘分组不丢同路线 log
 *  - 无路线数据时优雅降级（不阻塞）
 */

function wave(names: string[]): TacticalPull {
  return {
    index: 0,
    npcs: names.map((name, i) => ({ guid: `Creature-0-1-2-3-${1000 + i}`, name, npcId: 1000 + i, kind: "trash" })),
    startMs: 0,
    endMs: 0,
    startSec: 0,
    endSec: 0,
    chainFromPrev: false,
    kind: "trash",
  };
}

function run(pulls: TacticalPull[]): TacticalRun {
  return {
    dungeon: "Mists of Tirna Scithe",
    level: 15,
    runStartMs: 0,
    runEndMs: 100_000,
    durationSec: 100,
    pulls,
  };
}

const routeA = buildRouteFingerprint(run([wave(["Pack Alpha", "Pack Alpha"]), wave(["Devourer", "Devourer"])]));
const routeAVariant = buildRouteFingerprint(run([wave(["Pack Alpha", "Pack Alpha", "Devourer", "Devourer"])])); // 合波
const routeB = buildRouteFingerprint(run([wave(["Guardian"]), wave(["Hound"])]));

const compMelee = buildCompProfile([
  { class: "Demon Hunter" },
  { class: "Monk" },
  { class: "Warrior" },
  { class: "Rogue" },
  { class: "Death Knight" },
]);
const compMeleeSwapped = buildCompProfile([
  { class: "Demon Hunter" },
  { class: "Monk" },
  { class: "Warrior" },
  { class: "Paladin" },
  { class: "Death Knight" },
]);

describe("参考目标推荐（T23）", () => {
  it("推荐排序按综合相似度降序，无数据者排最后", () => {
    const user: ReferenceProfile = { id: "user", dungeon: "Mists of Tirna Scithe", route: routeA, comp: compMelee };
    const candidates: ReferenceProfile[] = [
      { id: "no-data", dungeon: "Mists of Tirna Scithe" },
      { id: "same", dungeon: "Mists of Tirna Scithe", route: routeAVariant, comp: compMeleeSwapped },
      { id: "diff-route", dungeon: "Mists of Tirna Scithe", route: routeB, comp: compMelee },
    ];
    const ranked = rankReferences(user, candidates);
    expect(ranked.map((r) => r.id)[0]).toBe("same");
    expect(ranked.map((r) => r.id)[ranked.length - 1]).toBe("no-data");
    // 同路线同阵容 → 双维度可用、combined 非空、note 非空
    expect(ranked[0].combined).not.toBeNull();
    expect(ranked[0].note).toContain("路线相似度");
    expect(ranked[0].note).toContain("阵容相似度");
  });

  it("无路线/阵容数据时优雅降级（combined/note 为 null）", () => {
    const user: ReferenceProfile = { id: "user", dungeon: "X" };
    const c = compareReference(user, { id: "c", dungeon: "X" });
    expect(c.routeSimilarity).toBeNull();
    expect(c.compSimilarity).toBeNull();
    expect(c.combined).toBeNull();
    expect(c.note).toBeNull();
  });

  it("仅部分维度可用时仍给出参考（不因缺一维阻塞）", () => {
    const user: ReferenceProfile = { id: "user", dungeon: "X", route: routeA };
    const c = compareReference(user, { id: "c", dungeon: "X", route: routeAVariant });
    expect(c.routeSimilarity).not.toBeNull();
    expect(c.compSimilarity).toBeNull();
    expect(c.combined).not.toBeNull();
    expect(c.note).not.toContain("阵容相似度");
  });
});

describe("挖掘分组（T23）", () => {
  it("同路线（不同波次边界）归同组，不丢任何 log", () => {
    const groups = groupByRoute([
      { id: "log1", route: routeA },
      { id: "log2", route: routeAVariant },
      { id: "log3", route: routeB },
      { id: "log4" }, // 无路线数据
    ]);
    const allIds = groups.flatMap((g) => g.ids).sort();
    expect(allIds).toEqual(["log1", "log2", "log3", "log4"]); // 不丢数据源

    const sameGroup = groups.find((g) => g.ids.includes("log1"))!;
    expect(sameGroup.ids).toContain("log2"); // 同路线合波 → 同组
    expect(sameGroup.sameRoute).toBe(true);

    const diffGroup = groups.find((g) => g.ids.includes("log3"))!;
    expect(diffGroup.ids).not.toContain("log1");

    const noRouteGroup = groups.find((g) => g.ids.includes("log4"))!;
    expect(noRouteGroup.sameRoute).toBe(false); // 独立组，标注不可按路线归并
  });
});
