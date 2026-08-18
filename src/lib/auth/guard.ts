import {
  CODE_TTL_MS,
  LOCK_TTL_MS,
  MAX_FAILED_ATTEMPTS,
} from "@/lib/auth/types";
import { kvDelete, kvGet, kvSet } from "@/lib/auth/kv-file";

/**
 * 频控与锁定（T3 验收：验证码频控；错 5 次锁 10 分钟 —— FR-7）。
 *
 * 两个层次：
 *  1. 发送频控（内存滑动窗口）：同一邮箱/同一 IP 单位时间内限发；
 *     mock 模式单进程有效；生产环境 Supabase Auth 自身也有发送限流
 *     （阶段 5 可再加 Upstash 等分布式频控，架构不变）。
 *  2. 验证失败锁定（持久化，跨请求/重启有效）：错 5 次锁定该邮箱 10 分钟。
 */

// ---------- 内存滑动窗口（发送频控） ----------
const windows = new Map<string, number[]>();

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec?: number;
}

export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
  nowMs: number = Date.now(),
): RateLimitResult {
  const list = (windows.get(key) ?? []).filter((t) => nowMs - t < windowMs);
  if (list.length >= max) {
    const oldest = list[0];
    windows.set(key, list);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000)) };
  }
  list.push(nowMs);
  windows.set(key, list);
  return { ok: true };
}

/** 测试用：清空窗口状态。 */
export function resetRateLimiterForTest(): void {
  windows.clear();
}

// ---------- 验证失败锁定（持久化） ----------
const failedKey = (email: string) => `otp:failed:${email.toLowerCase()}`;
const lockedKey = (email: string) => `otp:locked:${email.toLowerCase()}`;

export async function isLockedOut(email: string): Promise<{ locked: boolean; lockedUntil?: number }> {
  const until = await kvGet<number>(lockedKey(email));
  if (until === null) return { locked: false };
  if (until <= Date.now()) {
    await kvDelete(lockedKey(email));
    return { locked: false };
  }
  return { locked: true, lockedUntil: until };
}

/** 记录一次验证失败；达到 MAX_FAILED_ATTEMPTS 次后锁定 LOCK_TTL_MS。 */
export async function recordFailedAttempt(email: string): Promise<{ locked: boolean }> {
  const failed = (await kvGet<number>(failedKey(email))) ?? 0;
  const next = failed + 1;
  if (next >= MAX_FAILED_ATTEMPTS) {
    await kvSet(lockedKey(email), Date.now() + LOCK_TTL_MS, LOCK_TTL_MS);
    await kvDelete(failedKey(email));
    return { locked: true };
  }
  await kvSet(failedKey(email), next, LOCK_TTL_MS);
  return { locked: false };
}

/** 验证成功后清零失败计数。 */
export async function resetFailedAttempts(email: string): Promise<void> {
  await kvDelete(failedKey(email));
  await kvDelete(lockedKey(email));
}

/** 生成 6 位数字验证码并存储（10 分钟有效）。 */
const codeKey = (email: string) => `otp:code:${email.toLowerCase()}`;

export interface StoredCode {
  code: string;
  expiresAt: number;
}

export async function storeCode(email: string, code: string): Promise<void> {
  await kvSet(codeKey(email), { code, expiresAt: Date.now() + CODE_TTL_MS }, CODE_TTL_MS);
}

export async function getStoredCode(email: string): Promise<StoredCode | null> {
  return kvGet<StoredCode>(codeKey(email));
}

export async function clearCode(email: string): Promise<void> {
  await kvDelete(codeKey(email));
}

export function generateOtpCode(): string {
  // 6 位数字（首位可为 0）
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}
