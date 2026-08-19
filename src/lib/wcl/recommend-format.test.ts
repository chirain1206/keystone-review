import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatDurationSec,
  formatParse,
  formatPercent,
  formatPerformance,
  formatRouteSimilarity,
  sortRecommendations,
} from "@/lib/wcl/recommend-format";

/**
 * 自动对比推荐前端纯展示函数验收：相似度百分比、路线"暂无"文案、时长、
 * 该专精玩家表现（parse/DPS），以及"表现优先，相似度其次"排序。
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

describe("formatParse / formatAmount / formatPerformance", () => {
  it("parse 分位 → 「parse 92%」，null → 「—」", () => {
    expect(formatParse(92.4)).toBe("parse 92%");
    expect(formatParse(null)).toBe("—");
  });

  it("指标值 → 「DPS 12.3k」，大数缩写，null → 「—」", () => {
    expect(formatAmount(12_345)).toBe("DPS 12.3k");
    expect(formatAmount(8_500, "hps")).toBe("HPS 8.5k");
    expect(formatAmount(9_800)).toBe("DPS 9.8k");
    expect(formatAmount(null)).toBe("—");
  });

  it("组合表现文案：有 parse/指标时拼接，皆无 → 「—」", () => {
    expect(formatPerformance(92, 12_345, "dps")).toBe("parse 92% / DPS 12.3k");
    expect(formatPerformance(null, 12_345, "dps")).toBe("DPS 12.3k");
    expect(formatPerformance(92, null, "dps")).toBe("parse 92%");
    expect(formatPerformance(null, null)).toBe("—");
  });
});

describe("sortRecommendations（表现优先，相似度其次）", () => {
  const item = (
    id: string,
    parsePercent: number | null,
    routeSimilarity: number | null,
    compSimilarity: number | null,
  ) => ({ id, parsePercent, routeSimilarity, compSimilarity, combined: null });

  it("主排序 parse 降序，null 排最后，再比路线/阵容", () => {
    const list = [
      item("a", 90, 0.8, 0.9),
      item("b", 95, 0.1, 0.1),
      item("c", 90, 0.9, 0.5),
      item("d", null, 0.9, 0.8),
    ];
    expect(sortRecommendations(list).map((x) => x.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("不改动入参", () => {
    const list = [item("a", 90, 0.8, 0.9)];
    sortRecommendations(list);
    expect(list[0].id).toBe("a");
  });
});
