import { describe, expect, it } from "vitest";
import {
  formatDurationSec,
  formatPercent,
  formatRouteSimilarity,
  sortByCombined,
} from "@/lib/wcl/recommend-format";

/**
 * 自动对比推荐前端纯展示函数验收：相似度百分比、路线"暂无"文案、时长、排序。
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

describe("sortByCombined", () => {
  it("综合分降序，null 排最后，不改动入参", () => {
    const list = [
      { id: "a", combined: null },
      { id: "b", combined: 0.8 },
      { id: "c", combined: 0.9 },
    ];
    const sorted = sortByCombined(list);
    expect(sorted.map((x) => x.id)).toEqual(["c", "b", "a"]);
    expect(list.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("全 null 时保持相对顺序", () => {
    const list = [
      { id: "a", combined: null },
      { id: "b", combined: null },
    ];
    expect(sortByCombined(list).map((x) => x.id)).toEqual(["a", "b"]);
  });
});
