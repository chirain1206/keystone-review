import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatDurationSec,
  formatPercent,
  formatPerformance,
  formatRouteSimilarity,
  sortRecommendations,
} from "@/lib/wcl/recommend-format";

/**
 * 自动对比推荐前端纯展示函数验收：相似度百分比、路线"暂无"文案、时长、
 * 该专精玩家表现（DPS/score），以及"表现优先，相似度其次"排序。
 */

describe("formatPercent / formatRouteSimilarity", () => {
  it("相似度 0–1 → 百分比，null → 占位符", () => {
    expect(formatPercent(0.87)).toBe("87%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });

  it("路线相似度 null → 「路线暂无」（区分于阵容的「—」）", () => {
    expect(formatRouteSimilarity(0.6)).toBe("60%");
    expect(formatRouteSimilarity(null)).toBe("路线暂无");
  });
});

describe("formatDurationSec", () => {
  it("秒 → 「X 分 Y 秒」", () => {
    expect(formatDurationSec(1650)).toBe("27 分 30 秒");
    expect(formatDurationSec(0)).toBe("0 分 0 秒");
  });
});

describe("formatAmount / formatPerformance", () => {
  it("指标值 → 「DPS 12.3k」，大数缩写，null → 「—」", () => {
    expect(formatAmount(12_345)).toBe("DPS 12.3k");
    expect(formatAmount(8_500, "hps")).toBe("HPS 8.5k");
    expect(formatAmount(null)).toBe("—");
  });

  it("组合表现文案：有 DPS/score 时拼接，皆无 → 「—」", () => {
    expect(formatPerformance(12_345, "dps", 335)).toBe("DPS 12.3k · 335 分");
    expect(formatPerformance(12_345, "dps", null)).toBe("DPS 12.3k");
    expect(formatPerformance(null, "dps", 335)).toBe("335 分");
    expect(formatPerformance(null, "dps", null)).toBe("—");
  });
});

describe("sortRecommendations（表现优先，相似度其次）", () => {
  const item = (
    id: string,
    amount: number | null,
    routeSimilarity: number | null,
    compSimilarity: number | null,
  ) => ({ id, amount, routeSimilarity, compSimilarity, combined: null });

  it("主排序 DPS 降序，null 排最后，再比路线/阵容", () => {
    const list = [
      item("a", 11_000, 0.8, 0.9),
      item("b", 13_000, 0.1, 0.1),
      item("c", 11_000, 0.9, 0.5),
      item("d", null, 0.9, 0.8),
    ];
    expect(sortRecommendations(list).map((x) => x.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("不改动入参", () => {
    const list = [item("a", 11_000, 0.8, 0.9)];
    sortRecommendations(list);
    expect(list[0].id).toBe("a");
  });
});
