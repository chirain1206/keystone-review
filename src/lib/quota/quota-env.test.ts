import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FREE_DAILY_REPORT_LIMIT 环境变量覆盖验收（FR-7 额度，仅本地验收用）。
 * 通过 vi.resetModules() + 动态 import，验证 DAILY_REPORT_LIMIT 随环境变量变化：
 *  - 未配置 → 默认 3（生产行为不变）
 *  - 正整数（如 100）→ 使用该值
 *  - 非法值（非数字 / 0 / 负数 / 小数 / 空串）→ 回退 3
 */

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const saved = process.env.FREE_DAILY_REPORT_LIMIT;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  setEnv("FREE_DAILY_REPORT_LIMIT", saved);
  vi.resetModules();
});

describe("FREE_DAILY_REPORT_LIMIT 环境变量覆盖", () => {
  it("未配置时默认 3", async () => {
    setEnv("FREE_DAILY_REPORT_LIMIT", undefined);
    const { DAILY_REPORT_LIMIT } = await import("./quota");
    expect(DAILY_REPORT_LIMIT).toBe(3);
  });

  it("配置 100 时使用 100", async () => {
    setEnv("FREE_DAILY_REPORT_LIMIT", "100");
    const { DAILY_REPORT_LIMIT } = await import("./quota");
    expect(DAILY_REPORT_LIMIT).toBe(100);
  });

  it("非法值回退 3", async () => {
    for (const bad of ["abc", "0", "-3", "3.5", ""]) {
      setEnv("FREE_DAILY_REPORT_LIMIT", bad);
      vi.resetModules();
      const { DAILY_REPORT_LIMIT } = await import("./quota");
      expect(DAILY_REPORT_LIMIT, `非法值 ${JSON.stringify(bad)} 应回退 3`).toBe(3);
    }
  });
});
