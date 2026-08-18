import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { envConfig } from "@/lib/env";
import type { AuthProvider, AuthUser } from "@/lib/auth/types";
import {
  isLockedOut,
  recordFailedAttempt,
  resetFailedAttempts,
} from "@/lib/auth/guard";
import { getRepo } from "@/lib/db";

/**
 * 生产账号实现：Supabase passwordless 邮箱验证码 OTP。
 *  - 验证码邮件由 Supabase Auth 发出（部署阶段在 Supabase 后台把 SMTP
 *    配成 Resend 免费档，即 TECH-DESIGN「Resend SMTP」方案）。
 *  - 会话使用 Supabase 原生 cookie（@supabase/ssr）。
 *  - 错 5 次锁 10 分钟的额外防线仍由 guard 提供（包在 Supabase 校验外层）。
 */

export class SupabaseAuthProvider implements AuthProvider {
  readonly mode = "supabase" as const;

  constructor(
    private req: NextRequest,
    private res: NextResponse,
  ) {}

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

  async requestCode(email: string): Promise<{ ok: boolean; error?: string }> {
    const lock = await isLockedOut(email);
    if (lock.locked) {
      return { ok: false, error: "该邮箱验证失败次数过多，已锁定 10 分钟，请稍后再试" };
    }
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

  async getSession(): Promise<AuthUser | null> {
    const { data } = await this.client().auth.getUser();
    if (!data.user) return null;
    return { id: data.user.id, email: data.user.email ?? "" };
  }

  async signOut(): Promise<void> {
    await this.client().auth.signOut();
  }
}
