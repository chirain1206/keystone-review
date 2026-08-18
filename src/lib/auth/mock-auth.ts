import { randomBytes } from "node:crypto";
import { envConfig } from "@/lib/env";
import {
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  type AuthProvider,
  type AuthUser,
  type CookieBridge,
} from "@/lib/auth/types";
import {
  clearCode,
  generateOtpCode,
  getStoredCode,
  isLockedOut,
  recordFailedAttempt,
  resetFailedAttempts,
  storeCode,
} from "@/lib/auth/guard";
import { kvDelete, kvGet, kvSet } from "@/lib/auth/kv-file";
import { sendVerificationCodeEmail } from "@/lib/email/provider";
import { getRepo } from "@/lib/db";

/**
 * Mock/开发模式账号实现：
 *  - 验证码：随机 6 位，10 分钟有效；DEV_LOG_CODES=true 时打印到服务端日志
 *    （登录页在 mock 模式会提示从服务端日志查看）。
 *  - 会话：256-bit 随机 token 写入 httpOnly cookie，服务端 KV 存映射。
 *  - 用户身份：mock 模式使用稳定的 "mock:<email>" 哈希 id。
 * 行为语义与 Supabase 实现一致（含错 5 次锁定 10 分钟）。
 */

const sessionKey = (token: string) => `session:${token}`;

function mockUserId(email: string): string {
  // 稳定可复现的 mock 用户 id（非真实哈希，仅开发用）
  let h = 0;
  for (const ch of email.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `mock-${Math.abs(h).toString(36)}`;
}

export class MockAuthProvider implements AuthProvider {
  readonly mode = "mock" as const;

  constructor(private cookies: CookieBridge) {}

  async requestCode(email: string): Promise<{ ok: boolean; error?: string }> {
    const lock = await isLockedOut(email);
    if (lock.locked) {
      return { ok: false, error: "该邮箱验证失败次数过多，已锁定 10 分钟，请稍后再试" };
    }
    const code = generateOtpCode();
    await storeCode(email, code);
    const sent = await sendVerificationCodeEmail(email, code);
    if (!sent) return { ok: false, error: "验证码邮件发送失败，请稍后重试" };
    return { ok: true };
  }

  async verifyCode(
    email: string,
    code: string,
  ): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
    const lock = await isLockedOut(email);
    if (lock.locked) {
      return { ok: false, error: "该邮箱验证失败次数过多，已锁定 10 分钟，请稍后再试" };
    }

    const stored = await getStoredCode(email);
    const correct = stored !== null && stored.code === code.trim();
    if (!correct) {
      const failed = await recordFailedAttempt(email);
      return {
        ok: false,
        error: failed.locked
          ? "验证码连续错误 5 次，该邮箱已锁定 10 分钟"
          : "验证码错误，请重新输入",
      };
    }

    await resetFailedAttempts(email);
    await clearCode(email);

    const userId = mockUserId(email);
    const user: AuthUser = { id: userId, email };

    // 建立会话
    const token = randomBytes(32).toString("hex");
    await kvSet(sessionKey(token), user, SESSION_TTL_SEC * 1000);
    this.cookies.set(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SEC });

    // 同步 profile（时区默认值，登录后可在设置里改）
    await getRepo().upsertProfile({ id: userId, email, timezone: "Asia/Shanghai" });

    if (envConfig.devLogCodes) {
      console.log(`[auth:mock] 登录成功 ${email} (id=${userId})`);
    }
    return { ok: true, user };
  }

  async getSession(): Promise<AuthUser | null> {
    const token = this.cookies.get(SESSION_COOKIE);
    if (!token) return null;
    return kvGet<AuthUser>(sessionKey(token));
  }

  async signOut(): Promise<void> {
    const token = this.cookies.get(SESSION_COOKIE);
    if (token) await kvDelete(sessionKey(token));
    this.cookies.delete(SESSION_COOKIE);
  }
}
