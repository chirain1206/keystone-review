import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  checkRateLimit,
  generateOtpCode,
  getStoredCode,
  isLockedOut,
  recordFailedAttempt,
  resetFailedAttempts,
  resetRateLimiterForTest,
  storeCode,
} from "@/lib/auth/guard";
import { kvCleanup, kvSet } from "@/lib/auth/kv-file";
import { MockAuthProvider } from "@/lib/auth/mock-auth";
import type { CookieBridge } from "@/lib/auth/types";
import { MAX_FAILED_ATTEMPTS } from "@/lib/auth/types";

/**
 * T3 验收（FR-7 登录部分）：
 *  - 验证码 10 分钟有效、可重发
 *  - 错 5 次锁定 10 分钟
 *  - 邮箱/IP 频控
 *  - 会话建立/读取/登出
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-auth-test-${Date.now()}`);

beforeAll(() => {
  process.env.DATA_DIR = dir;
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  resetRateLimiterForTest();
});

function makeCookies(): { bridge: CookieBridge; store: Map<string, string> } {
  const store = new Map<string, string>();
  const bridge: CookieBridge = {
    get: (n) => store.get(n),
    set: (n, v) => void store.set(n, v),
    delete: (n) => void store.delete(n),
  };
  return { bridge, store };
}

describe("验证码生成与存储（guard）", () => {
  it("生成 6 位数字验证码", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it("验证码 10 分钟有效（TTL 语义）", async () => {
    await storeCode("a@test.com", "123456");
    const stored = await getStoredCode("a@test.com");
    expect(stored?.code).toBe("123456");
    expect(stored!.expiresAt - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it("验证码可重发（覆盖旧码）", async () => {
    await storeCode("a@test.com", "111111");
    await storeCode("a@test.com", "222222");
    expect((await getStoredCode("a@test.com"))?.code).toBe("222222");
  });
});

describe("错 5 次锁定 10 分钟（FR-7）", () => {
  it("连续失败 5 次后锁定", async () => {
    const email = "lock@test.com";
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      const r = await recordFailedAttempt(email);
      expect(r.locked).toBe(false);
    }
    const r = await recordFailedAttempt(email);
    expect(r.locked).toBe(true);
    const s = await isLockedOut(email);
    expect(s.locked).toBe(true);
    expect(s.lockedUntil!).toBeGreaterThan(Date.now());
  });

  it("锁定到期自动解除", async () => {
    const email = "lock2@test.com";
    // 直接注入一条"锁定至 1ms 前"的记录
    await kvSet(`otp:locked:${email}`, Date.now() - 1, 1000);
    expect((await isLockedOut(email)).locked).toBe(false);
  });

  it("成功验证清零失败计数", async () => {
    const email = "reset@test.com";
    for (let i = 0; i < 3; i++) await recordFailedAttempt(email);
    await resetFailedAttempts(email);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      expect((await recordFailedAttempt(email)).locked).toBe(false);
    }
  });

  it("锁定期间拒绝验证（mock 全流程）", async () => {
    const email = "flow@test.com";
    const { bridge } = makeCookies();
    const auth = new MockAuthProvider(bridge);
    await auth.requestCode(email);
    const stored = await getStoredCode(email);
    // 先故意错 5 次
    for (let i = 0; i < 5; i++) {
      const r = await auth.verifyCode(email, "000000");
      expect(r.ok).toBe(false);
    }
    // 即使给正确验证码也被锁拒绝
    const r = await auth.verifyCode(email, stored!.code);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("锁定");
  });
});

describe("会话生命周期（mock）", () => {
  it("请求验证码 → 正确验证 → 建立会话 → 读取 → 登出", async () => {
    const email = "sess@test.com";
    const { bridge, store } = makeCookies();
    const auth = new MockAuthProvider(bridge);

    expect((await auth.requestCode(email)).ok).toBe(true);
    const stored = await getStoredCode(email);
    expect(stored).not.toBeNull();

    // 错一次不建立会话
    const bad = await auth.verifyCode(email, "999999");
    expect(bad.ok).toBe(false);

    const ok = await auth.verifyCode(email, stored!.code);
    expect(ok.ok).toBe(true);
    expect(ok.user?.email).toBe(email);
    expect([...store.keys()].some((k) => k === "wa_session")).toBe(true);

    const session = await auth.getSession();
    expect(session?.email).toBe(email);

    // 验证码一次性：再次验证应失败（已清除）
    const again = await auth.verifyCode(email, stored!.code);
    expect(again.ok).toBe(false);

    await auth.signOut();
    expect(await auth.getSession()).toBeNull();
  });
});

describe("发送频控（内存滑动窗口）", () => {
  it("同邮箱 10 分钟窗口内最多 3 次", () => {
    const t0 = Date.now();
    expect(checkRateLimit("code:email:x@y.com", 3, 600_000, t0).ok).toBe(true);
    expect(checkRateLimit("code:email:x@y.com", 3, 600_000, t0 + 1000).ok).toBe(true);
    expect(checkRateLimit("code:email:x@y.com", 3, 600_000, t0 + 2000).ok).toBe(true);
    const r = checkRateLimit("code:email:x@y.com", 3, 600_000, t0 + 3000);
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it("窗口滑动后恢复可用", () => {
    const t0 = Date.now();
    checkRateLimit("code:email:z@y.com", 1, 60_000, t0);
    const later = checkRateLimit("code:email:z@y.com", 1, 60_000, t0 + 61_000);
    expect(later.ok).toBe(true);
  });
});

afterAll(async () => {
  await kvCleanup().catch(() => undefined);
});
