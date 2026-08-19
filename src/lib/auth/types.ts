import type { NextRequest, NextResponse } from "next/server";
import { envConfig } from "@/lib/env";

/**
 * 账号体系抽象（T3，FR-7 登录部分）。
 * 两种实现：
 *  - SupabaseAuthProvider（生产）：Supabase passwordless 邮箱验证码 OTP
 *  - MockAuthProvider（开发/无密钥）：本地验证码 + 自有会话 cookie，
 *    流程与生产一致，可完整自测
 */

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthProvider {
  readonly mode: "supabase" | "mock";
  /** 发送验证码（10 分钟有效，可重发） */
  requestCode(email: string): Promise<{ ok: boolean; error?: string }>;
  /** 校验验证码；成功则建立会话并返回用户 */
  verifyCode(email: string, code: string): Promise<{ ok: boolean; user?: AuthUser; error?: string }>;
  /**
   * 校验邮箱魔法链接 token_hash（生产 Supabase 对新用户首次登录发 sign-in 链接，
   * 回调 ?token_hash=...&type=email / 老形式 ?code=...）；成功则建立会话并返回用户。
   * email 为可选兼容提示（前端 localStorage 最近邮箱），实现层以 token_hash 为准。
   * source 标记 token 来源（token_hash/code）：老形式 ?code= 类型歧义，email 验证
   * 失败时服务端可回退 type:"signup" 兼容「确认注册链接」。
   */
  verifyLink(
    tokenHash: string,
    email?: string,
    source?: "token_hash" | "code",
  ): Promise<{ ok: boolean; user?: AuthUser; error?: string }>;
  /** 读取当前会话用户（无会话返回 null） */
  getSession(): Promise<AuthUser | null>;
  /** 登出并清除会话 */
  signOut(): Promise<void>;
}

/** cookie 读写桥（请求读 + 响应写）。 */
export interface CookieBridge {
  get(name: string): string | undefined;
  set(name: string, value: string, opts?: { maxAge?: number }): void;
  delete(name: string): void;
}

/** 生产部署走 HTTPS（APP_URL=https://…）时给 cookie 加 Secure 标记。 */
const cookieSecure = envConfig.appUrl.startsWith("https://");

export function cookieBridge(req: NextRequest, res: NextResponse): CookieBridge {
  return {
    get: (name) => req.cookies.get(name)?.value,
    set: (name, value, opts) => {
      res.cookies.set({
        name,
        value,
        httpOnly: true,
        sameSite: "lax",
        secure: cookieSecure,
        path: "/",
        maxAge: opts?.maxAge,
      });
    },
    delete: (name) => {
      res.cookies.set({
        name,
        value: "",
        httpOnly: true,
        sameSite: "lax",
        secure: cookieSecure,
        path: "/",
        maxAge: 0,
      });
    },
  };
}

/** 会话 cookie 名（mock 模式）；Supabase 模式使用其内置 cookie。 */
export const SESSION_COOKIE = "wa_session";
export const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 天
export const CODE_TTL_MS = 10 * 60 * 1000; // 验证码 10 分钟有效（FR-7）
export const LOCK_TTL_MS = 10 * 60 * 1000; // 错 5 次锁定 10 分钟（FR-7）
export const MAX_FAILED_ATTEMPTS = 5;
