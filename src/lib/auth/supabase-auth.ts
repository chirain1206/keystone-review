import { randomBytes } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient, type VerifyOtpParams } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";
import { envConfig } from "@/lib/env";
import type { AuthProvider, AuthUser } from "@/lib/auth/types";
import { cookieBridge, SESSION_COOKIE, SESSION_TTL_SEC } from "@/lib/auth/types";
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
 * 生产账号实现：Supabase passwordless 邮箱验证码 OTP。
 *
 * 发码（requestCode）按 EMAIL_MODE 分两种：
 *  - supabase（默认）：signInWithOtp —— 验证码由 Supabase Auth 自带邮件服务发出，
 *    无需任何 SMTP/Resend 配置（内测阶段无域名时用这个）。
 *  - resend：本地生成 6 位验证码 → 存储（guard）→ 走 Resend REST 适配器发送
 *    （sendVerificationCodeEmail），验证时本地比对；会话用自有 cookie。
 *    买域名后可切回此模式（需 RESEND_API_KEY + EMAIL_FROM）。
 *  - 会话：supabase 模式用 Supabase 原生 cookie；resend 模式用自有 cookie
 *    （Supabase 无法为应用自生成的验证码签发会话，故经 service role 确保
 *    auth.users 存在以拿到真实 UUID，满足 profiles.id 外键）。
 *  - 错 5 次锁 10 分钟的额外防线仍由 guard 提供（包在校验外层，两种模式一致）。
 */

const sessionKey = (token: string) => `session:${token}`;

export class SupabaseAuthProvider implements AuthProvider {
  readonly mode = "supabase" as const;

  constructor(
    private req: NextRequest,
    private res: NextResponse,
  ) {}

  private get emailMode(): "supabase" | "resend" {
    return envConfig.emailMode;
  }

  /** anon 客户端（supabase 模式：OTP + 会话）。 */
  private client() {
    return createServerClient(envConfig.supabaseUrl, envConfig.supabaseAnonKey, {
      cookies: {
        getAll: () => this.req.cookies.getAll(),
        setAll: (list) => {
          const secure = envConfig.appUrl.startsWith("https://");
          for (const c of list) {
            this.res.cookies.set({
              name: c.name,
              value: c.value,
              httpOnly: true,
              sameSite: "lax",
              secure,
              path: c.options?.path ?? "/",
              maxAge: c.options?.maxAge,
            });
          }
        },
      },
    });
  }

  /** service role 客户端（resend 模式：确保 auth.users 存在以拿到真实 UUID）。 */
  private adminClient() {
    return createClient(envConfig.supabaseUrl, envConfig.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private cookies() {
    return cookieBridge(this.req, this.res);
  }

  async requestCode(email: string): Promise<{ ok: boolean; error?: string }> {
    const lock = await isLockedOut(email);
    if (lock.locked) {
      return { ok: false, error: "该邮箱验证失败次数过多，已锁定 10 分钟，请稍后再试" };
    }

    if (this.emailMode === "resend") {
      // Resend 适配器路径：本地生成 → 存储 → Resend REST 发送
      const code = generateOtpCode();
      await storeCode(email, code);
      const sent = await sendVerificationCodeEmail(email, code);
      if (!sent) return { ok: false, error: "验证码邮件发送失败，请稍后重试" };
      return { ok: true };
    }

    // supabase 模式：Supabase 自带邮件服务发送（无需 SMTP/Resend 配置）
    const { error } = await this.client().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) {
      if (error.status === 429) {
        return { ok: false, error: "验证码请求过于频繁，请稍后再试" };
      }
      return { ok: false, error: "验证码发送失败，请稍后重试" };
    }
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

    if (this.emailMode === "resend") {
      return this.verifyResendCode(email, code);
    }

    const { data, error } = await this.client().auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    if (error || !data.user) {
      const failed = await recordFailedAttempt(email);
      return {
        ok: false,
        error: failed.locked
          ? "验证码连续错误 5 次，该邮箱已锁定 10 分钟"
          : "验证码错误或已过期，请重新输入",
      };
    }

    await resetFailedAttempts(email);
    await getRepo().upsertProfile({
      id: data.user.id,
      email: data.user.email ?? email,
      timezone: "Asia/Shanghai",
    });
    return {
      ok: true,
      user: { id: data.user.id, email: data.user.email ?? email },
    };
  }

  /**
   * 邮箱魔法链接登录（FR-7 增强）：生产 Supabase 对新用户首次登录发送的是
   * sign-in 链接（而非 6 位验证码），用户点击后带 ?token_hash=... 回到站点。
   * 这里用 verifyOtp({ type: "email", token_hash }) 完成会话建立（cookie 由
   * createServerClient 桥接写入 res）。
   *
   * 优先 token_hash 验证；email 仅作兼容提示（老版本 gotrue 若要求 email 时
   * 一并带上，运行时 token_hash 优先、email 无害）。resend 模式发送的是
   * 6 位验证码（无魔法链接），token_hash 不可验证 → 直接判失效。
   */
  async verifyLink(
    tokenHash: string,
    email?: string,
  ): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
    if (this.emailMode === "resend") {
      return { ok: false, error: "链接已失效，请重新登录" };
    }

    const params: { type: "email"; token_hash: string; email?: string } = {
      type: "email",
      token_hash: tokenHash,
    };
    if (email) params.email = email;

    const { data, error } = await this.client().auth.verifyOtp(params as VerifyOtpParams);
    if (error || !data.user) {
      return { ok: false, error: "链接已失效，请重新登录" };
    }

    await getRepo().upsertProfile({
      id: data.user.id,
      email: data.user.email ?? email ?? "",
      timezone: "Asia/Shanghai",
    });
    return {
      ok: true,
      user: { id: data.user.id, email: data.user.email ?? email ?? "" },
    };
  }

  /** resend 模式：本地比对验证码 + 自有 cookie 会话。 */
  private async verifyResendCode(
    email: string,
    code: string,
  ): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
    const stored = await getStoredCode(email);
    const correct = stored !== null && stored.code === code.trim();
    if (!correct) {
      const failed = await recordFailedAttempt(email);
      return {
        ok: false,
        error: failed.locked
          ? "验证码连续错误 5 次，该邮箱已锁定 10 分钟"
          : "验证码错误或已过期，请重新输入",
      };
    }

    await resetFailedAttempts(email);
    await clearCode(email);

    const userId = await this.ensureAuthUser(email);
    await getRepo().upsertProfile({ id: userId, email, timezone: "Asia/Shanghai" });

    const token = randomBytes(32).toString("hex");
    await kvSet(sessionKey(token), { id: userId, email }, SESSION_TTL_SEC * 1000);
    this.cookies().set(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SEC });

    return { ok: true, user: { id: userId, email } };
  }

  /**
   * 确保 auth.users 中存在该邮箱（service role，email_confirm:true 不另发邮件），
   * 返回真实 UUID 以满足 profiles.id 外键。
   */
  private async ensureAuthUser(email: string): Promise<string> {
    const created = await this.adminClient().auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (!created.error && created.data?.user) return created.data.user.id;

    // 已存在 → 定位（内测小规模单页 1000 足够；超出需分页遍历）
    const list = await this.adminClient().auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list.data?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) return existing.id;
    throw new Error(`无法为用户 ${email} 建立账号`);
  }

  async getSession(): Promise<AuthUser | null> {
    if (this.emailMode === "resend") {
      const token = this.cookies().get(SESSION_COOKIE);
      if (!token) return null;
      return kvGet<AuthUser>(sessionKey(token));
    }
    const { data } = await this.client().auth.getUser();
    if (!data.user) return null;
    return { id: data.user.id, email: data.user.email ?? "" };
  }

  async signOut(): Promise<void> {
    if (this.emailMode === "resend") {
      const token = this.cookies().get(SESSION_COOKIE);
      if (token) await kvDelete(sessionKey(token));
      this.cookies().delete(SESSION_COOKIE);
      return;
    }
    await this.client().auth.signOut();
  }
}
