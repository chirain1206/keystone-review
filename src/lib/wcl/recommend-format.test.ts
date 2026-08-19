import { describe, expect, it } from "vitest";
import {
  buildLevelRange,
  buildPerformanceCell,
  buildRecommendationRow,
  formatAmount,
  formatDurationSec,
  formatFightDate,
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

  it("估算 Key % 加 「~」 前缀", () => {
    expect(formatKeyPercent(50, true)).toBe("Key % ~50");
    expect(formatKeyPercent(null, true)).toBe("Key % —");
  });

  it("表现拼接：Key % 优先，DPS 为次，全无 → 「—」", () => {
    expect(formatPerformance(88, 12_345, "dps")).toBe("Key % 88 · DPS 12.3k");
    expect(formatPerformance(88, null, "dps")).toBe("Key % 88");
    expect(formatPerformance(null, 12_345, "dps")).toBe("DPS 12.3k");
    expect(formatPerformance(null, null, "dps")).toBe("—");
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

describe("buildPerformanceCell（表现列压缩格式化）", () => {
  it("有 Key %：Key 突出 + DPS 灰显", () => {
    expect(buildPerformanceCell(88, 12_345, "dps")).toEqual({
      key: "Key % 88",
      secondary: "DPS 12.3k",
      dps: null,
    });
  });

  it("有 Key % 但无 DPS：仅 Key", () => {
    expect(buildPerformanceCell(88, null, "dps")).toEqual({
      key: "Key % 88",
      secondary: null,
      dps: null,
    });
  });

  it("估算 Key %：key 带 「~」 前缀", () => {
    expect(buildPerformanceCell(50, 12_345, "dps", true)).toEqual({
      key: "Key % ~50",
      secondary: "DPS 12.3k",
      dps: null,
    });
  });

  it("无 Key %：只显 DPS（兜底）", () => {
    expect(buildPerformanceCell(null, 12_345, "dps")).toEqual({
      key: null,
      secondary: null,
      dps: "DPS 12.3k",
    });
  });

  it("全无数据：dps 为 null（渲染层回退「—」）", () => {
    expect(buildPerformanceCell(null, null, "dps")).toEqual({
      key: null,
      secondary: null,
      dps: null,
    });
  });
});

describe("buildRecommendationRow / buildLevelRange（行渲染）", () => {
  const input = {
    level: 10,
    keyPercent: 88,
    keyPercentEstimated: false,
    amount: 12_345,
    metricName: "dps",
    compSimilarity: 0.87,
    routeSimilarity: 0.6,
    durationSec: 1650,
    success: true,
    fightStartTimeMs: null as number | null,
    stale: false,
  };

  it("单行字段：层数/表现/阵容/路线/时长/日期/限时", () => {
    expect(buildRecommendationRow(input)).toEqual({
      level: "10",
      performance: { key: "Key % 88", secondary: "DPS 12.3k", dps: null },
      comp: "87%",
      route: "60%",
      duration: "27 分 30 秒",
      date: "—", // 时间未知
      success: true,
      stale: false,
    });
  });

  it("层数缺失 → 「—」", () => {
    expect(buildRecommendationRow({ ...input, level: null }).level).toBe("—");
  });

  it("较早候选标注 stale 且日期随语言切换", () => {
    const now = new Date("2026-08-20T12:00:00Z").getTime();
    const ms = new Date("2026-08-17T12:00:00Z").getTime(); // 3 天前
    const row = buildRecommendationRow({ ...input, fightStartTimeMs: ms, stale: true }, { lang: "zh", nowMs: now });
    expect(row.stale).toBe(true);
    expect(row.date).toBe("3 天前");
    const rowEn = buildRecommendationRow({ ...input, fightStartTimeMs: ms, stale: true }, { lang: "en", nowMs: now });
    expect(rowEn.date).toBe("3 days ago");
  });

  it("层数范围：多值去重升序、单值、空", () => {
    expect(buildLevelRange([10, 11, 10, null])).toBe("10–11");
    expect(buildLevelRange([10])).toBe("10");
    expect(buildLevelRange([null, null])).toBe("—");
  });
});

describe("formatFightDate（战斗日期，随中/英切换）", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date("2026-08-20T12:00:00Z").getTime();

  it("时间未知 → 「—」", () => {
    expect(formatFightDate(null, now, "zh")).toBe("—");
    expect(formatFightDate(Number.NaN, now, "zh")).toBe("—");
  });

  it("当天 / 昨天 / N 天前（zh）", () => {
    expect(formatFightDate(now - 2 * 60 * 60 * 1000, now, "zh")).toBe("今天");
    expect(formatFightDate(now - 1 * DAY, now, "zh")).toBe("昨天");
    expect(formatFightDate(now - 3 * DAY, now, "zh")).toBe("3 天前");
  });

  it("en 模式英文格式（当天/昨天/N 天前）", () => {
    expect(formatFightDate(now - 2 * 60 * 60 * 1000, now, "en")).toBe("Today");
    expect(formatFightDate(now - 1 * DAY, now, "en")).toBe("Yesterday");
    expect(formatFightDate(now - 3 * DAY, now, "en")).toBe("3 days ago");
  });

  it("更早 → 绝对日期（本地时区构造，时区无关）", () => {
    // 用本地时区构造 2026-07-31 12:00，避免断言依赖运行机器时区
    const localMs = new Date(2026, 6, 31, 12, 0, 0).getTime();
    const later = localMs + 20 * DAY;
    expect(formatFightDate(localMs, later, "zh")).toBe("7 月 31 日");
    expect(formatFightDate(localMs, later, "en")).toBe("Jul 31");
  });
});
