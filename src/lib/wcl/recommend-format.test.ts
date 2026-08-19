import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatDurationSec,
  formatKeyPercent,
  formatPercent,
  formatPerformance,
  formatRouteSimilarity,
  sortRecommendations,
} from "@/lib/wcl/recommend-format";

describe("formatPercent / formatRouteSimilarity / formatDurationSec", () => {
  it("相似度百分比 / 路线暂无 / 时长", () => {
    expect(formatPercent(0.87)).toBe("87%");
    expect(formatPercent(null)).toBe("—");
    expect(formatRouteSimilarity(0.6)).toBe("60%");
    expect(formatRouteSimilarity(null)).toBe("路线暂无");
    expect(formatDurationSec(1650)).toBe("27 分 30 秒");
  });
});

describe("formatKeyPercent / formatPerformance", () => {
  it("Key % → 「Key % 88」；null/0 → 「Key % —」", () => {
    expect(formatKeyPercent(88)).toBe("Key % 88");
    expect(formatKeyPercent(null)).toBe("Key % —");
    expect(formatKeyPercent(0)).toBe("Key % —");
    expect(formatKeyPercent(0.5)).toBe("Key % 1"); // 四舍五入
  });

  it("表现拼接：Key % 优先，Parse %/DPS 为次，全无 → 「—」", () => {
    expect(formatPerformance(88, 96, 12_345, "dps")).toBe("Key % 88 · Parse % 96 · DPS 12.3k");
    expect(formatPerformance(88, null, 12_345, "dps")).toBe("Key % 88 · DPS 12.3k");
    expect(formatPerformance(null, null, 12_345, "dps")).toBe("DPS 12.3k");
    expect(formatPerformance(null, null, null, "dps")).toBe("—");
  });

  it("DPS 缩写", () => {
    expect(formatAmount(12_345)).toBe("DPS 12.3k");
    expect(formatAmount(8_500, "hps")).toBe("HPS 8.5k");
    expect(formatAmount(null)).toBe("—");
  });

  it("相似度 NaN → 占位符", () => {
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatRouteSimilarity(Number.NaN)).toBe("路线暂无");
  });
});

describe("sortRecommendations（Key % 优先，相似度其次）", () => {
  const item = (id: string, keyPercent: number | null, amount: number | null, route: number | null, comp: number | null) => ({
    id,
    keyPercent,
    amount,
    routeSimilarity: route,
    compSimilarity: comp,
    combined: null,
  });

  it("主排序 Key % 降序，缺失排最后，DPS 兜底", () => {
    const list = [
      item("a", 88, 11_000, 0.8, 0.9),
      item("b", 95, 9_000, 0.1, 0.1),
      item("c", 88, 13_000, 0.9, 0.5),
      item("d", null, 13_000, 0.9, 0.8),
    ];
    expect(sortRecommendations(list).map((x) => x.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("不改动入参", () => {
    const list = [item("a", 88, 11_000, 0.8, 0.9)];
    sortRecommendations(list);
    expect(list[0].id).toBe("a");
  });
});
