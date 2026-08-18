import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getRepo, resetRepoForTest } from "@/lib/db";
import {
  checkDailyQuota,
  DAILY_REPORT_LIMIT,
  dayKey,
  nextDayBoundaryMs,
  QUOTA_EXHAUSTED_MESSAGE,
} from "@/lib/quota/quota";
import { verifyTurnstile } from "@/lib/turnstile/adapter";

/**
 * T9 验收（FR-7 额度部分）：
 *  - 每账号每日 3 次、按用户时区自然日
 *  - 第 4 次被拒且提示准确
 *  - 换时区边界正确
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
  vi.useRealTimers();
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

describe("每日额度（每账号每日 3 次）", () => {
  it("当日已用 3 次后第 4 次被拒，提示文案精确", async () => {
    vi.setSystemTime(FIXED_NOW);
    const repo = getRepo();
    for (let i = 0; i < DAILY_REPORT_LIMIT; i++) {
      await repo.createReport({
        userId: "user-a",
        sourceType: "file",
        dungeon: "Grim Batol",
        level: 10,
        spec: "Fire",
        playerName: "Mymage",
        playerClass: "Mage",
        result: true,
      });
    }
    const quota = await checkDailyQuota("user-a", "Asia/Shanghai", FIXED_NOW);
    expect(quota.allowed).toBe(false);
    expect(quota.used).toBe(DAILY_REPORT_LIMIT);
    expect(QUOTA_EXHAUSTED_MESSAGE).toContain("今日次数已用完");
    expect(QUOTA_EXHAUSTED_MESSAGE).toContain("深度复盘即将上线");
  });

  it("时区边界计数：同一时刻创建的 3 份报告在 UTC 与上海时区均记为当天 3 次", async () => {
    vi.setSystemTime(FIXED_NOW);
    const repo = getRepo();
    for (let i = 0; i < 3; i++) {
      await repo.createReport({
        userId: "user-c",
        sourceType: "file",
        dungeon: "Grim Batol",
        level: 10,
        spec: "Fire",
        playerName: "Mymage",
        playerClass: "Mage",
        result: true,
      });
    }
    // 用 UTC 视角统计：FIXED_NOW 是 08-18，创建时间也是 08-18（同一天）→ 3 次用尽
    const utcQuota = await checkDailyQuota("user-c", "UTC", FIXED_NOW);
    expect(utcQuota.used).toBe(3);
    expect(utcQuota.allowed).toBe(false);
    // 上海视角：FIXED_NOW 已是 08-19，报告创建于 08-19 凌晨 → 同样 3 次
    const shQuota = await checkDailyQuota("user-c", "Asia/Shanghai", FIXED_NOW);
    expect(shQuota.used).toBe(3);
    expect(shQuota.allowed).toBe(false);
  });

  it("跨日后额度恢复", async () => {
    vi.setSystemTime(FIXED_NOW);
    const repo = getRepo();
    for (let i = 0; i < 3; i++) {
      await repo.createReport({
        userId: "user-d",
        sourceType: "file",
        dungeon: "Grim Batol",
        level: 10,
        spec: "Fire",
        playerName: "Mymage",
        playerClass: "Mage",
        result: true,
      });
    }
    // 上海时区：FIXED_NOW 是 08-19，报告也在 08-19 → 用尽
    expect((await checkDailyQuota("user-d", "Asia/Shanghai", FIXED_NOW)).allowed).toBe(false);
    // 第二天（上海 08-20 12:00 = UTC 08-20 04:00）
    const nextDay = Date.UTC(2026, 7, 20, 4, 0, 0);
    const quota = await checkDailyQuota("user-d", "Asia/Shanghai", nextDay);
    expect(quota.allowed).toBe(true);
    expect(quota.used).toBe(0);
  });
});

describe("Turnstile（mock 模式）", () => {
  it("未配置密钥时放行（部署阶段配置后强制）", async () => {
    const r = await verifyTurnstile(undefined, "1.2.3.4");
    expect(r.ok).toBe(true);
  });
});
