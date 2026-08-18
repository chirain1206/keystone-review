import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { resetRepoForTest } from "@/lib/db";
import {
  checkDailyQuota,
  DAILY_REPORT_LIMIT,
  dayKey,
  nextDayBoundaryMs,
  QUOTA_EXHAUSTED_MESSAGE,
} from "@/lib/quota/quota";
import { verifyTurnstile } from "@/lib/turnstile/adapter";

/**
 * T9 验收（FR-7 额度部分）+ M-3 原子化：
 *  - 每账号每日 3 次、按用户时区自然日
 *  - 原子计数（先增后查）：前 3 次放行、第 4 次拒绝且提示准确
 *  - 换时区边界正确、跨日恢复
 *  - 人机验证（mock 模式放行；真实密钥在部署阶段配置后强制）
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-quota-test-${Date.now()}`);

beforeAll(() => {
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  resetRepoForTest();
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(() => resetRepoForTest());

// 2026-08-18 20:00 UTC = 2026-08-19 04:00 Asia/Shanghai
const FIXED_NOW = Date.UTC(2026, 7, 18, 20, 0, 0);

describe("时区自然日（dayKey / nextDayBoundaryMs）", () => {
  it("同一时刻在不同时区属于不同自然日", () => {
    expect(dayKey(FIXED_NOW, "UTC")).toBe("2026-08-18");
    expect(dayKey(FIXED_NOW, "Asia/Shanghai")).toBe("2026-08-19");
  });

  it("下一个自然日边界在 36 小时内且跨日生效", () => {
    const boundary = nextDayBoundaryMs(FIXED_NOW, "Asia/Shanghai");
    expect(boundary).toBeGreaterThan(FIXED_NOW);
    expect(boundary - FIXED_NOW).toBeLessThanOrEqual(36 * 3600_000);
    // boundary 一定落在新的一天；10 秒前一定还是旧的一天
    expect(dayKey(boundary, "Asia/Shanghai")).toBe("2026-08-20");
    expect(dayKey(boundary - 10_000, "Asia/Shanghai")).toBe("2026-08-19");
  });
});

describe("每日额度（每账号每日 3 次，原子计数）", () => {
  it("前 3 次放行、第 4 次拒绝，提示文案精确", async () => {
    for (let i = 1; i <= DAILY_REPORT_LIMIT; i++) {
      const quota = await checkDailyQuota("user-a", "Asia/Shanghai", FIXED_NOW);
      expect(quota.allowed).toBe(true);
      expect(quota.used).toBe(i);
    }
    const exhausted = await checkDailyQuota("user-a", "Asia/Shanghai", FIXED_NOW);
    expect(exhausted.allowed).toBe(false);
    expect(exhausted.used).toBe(DAILY_REPORT_LIMIT + 1);
    expect(QUOTA_EXHAUSTED_MESSAGE).toContain("今日次数已用完");
    expect(QUOTA_EXHAUSTED_MESSAGE).toContain("深度复盘即将上线");
  });

  it("时区自然日互不串扰：同一用户在不同时区各自计数", async () => {
    // FIXED_NOW 在 UTC 是 08-18、在上海是 08-19 → 不同 day key
    const sh = await checkDailyQuota("user-c", "Asia/Shanghai", FIXED_NOW);
    expect(sh.used).toBe(1);
    const utc = await checkDailyQuota("user-c", "UTC", FIXED_NOW);
    expect(utc.used).toBe(1);
    expect(sh.resetAt).toBeGreaterThan(FIXED_NOW);
  });

  it("跨日后额度恢复（新 day key 重新计数）", async () => {
    for (let i = 0; i < DAILY_REPORT_LIMIT; i++) {
      await checkDailyQuota("user-d", "Asia/Shanghai", FIXED_NOW);
    }
    const exhausted = await checkDailyQuota("user-d", "Asia/Shanghai", FIXED_NOW);
    expect(exhausted.allowed).toBe(false);

    // 第二天（上海 08-20 12:00 = UTC 08-20 04:00）
    const nextDay = Date.UTC(2026, 7, 20, 4, 0, 0);
    const quota = await checkDailyQuota("user-d", "Asia/Shanghai", nextDay);
    expect(quota.allowed).toBe(true);
    expect(quota.used).toBe(1);
  });
});

describe("Turnstile（mock 模式）", () => {
  it("未配置密钥时放行（部署阶段配置后强制）", async () => {
    const r = await verifyTurnstile(undefined, "1.2.3.4");
    expect(r.ok).toBe(true);
  });
});
