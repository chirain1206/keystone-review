import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { NextRequest, NextResponse } from "next/server";
import { SupabaseAuthProvider } from "@/lib/auth/supabase-auth";
import { getStoredCode } from "@/lib/auth/guard";

/**
 * EMAIL_MODE 发码分支选择（FR-7 登录邮件发送链路）。
 *  - supabase 模式：requestCode 走 signInWithOtp（Supabase 自带邮件），不落地本地验证码。
 *  - resend 模式：requestCode 走 Resend 适配器（本地生成 + 存储 + 发送）。
 * 不发真实网络请求：supabase 分支 mock @supabase/ssr；resend 分支在无 RESEND_API_KEY
 * 时 sendEmail 落控制台（mock 行为），但验证码已写入 guard 存储可断言。
 */

const { signInWithOtp } = vi.hoisted(() => ({ signInWithOtp: vi.fn() }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      signInWithOtp,
      verifyOtp: vi.fn(),
      getUser: vi.fn(),
      signOut: vi.fn(),
    },
  }),
}));

const dir = path.join(os.tmpdir(), `wow-analyzer-email-mode-${Date.now()}`);

beforeAll(() => {
  process.env.DATA_DIR = dir;
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

function makeProvider(): SupabaseAuthProvider {
  return new SupabaseAuthProvider(
    undefined as unknown as NextRequest,
    undefined as unknown as NextResponse,
  );
}

describe("EMAIL_MODE 发码分支选择", () => {
  it("resend 模式：requestCode 本地生成并存储验证码（走 Resend 适配器，而非 signInWithOtp）", async () => {
    process.env.EMAIL_MODE = "resend";
    signInWithOtp.mockClear();

    const auth = makeProvider();
    const email = "resend@test.com";
    const r = await auth.requestCode(email);

    expect(r.ok).toBe(true);
    // 走的是 Resend 适配器路径：验证码已落地 guard 存储（6 位数字）
    const stored = await getStoredCode(email);
    expect(stored).not.toBeNull();
    expect(stored!.code).toMatch(/^\d{6}$/);
    // 未调用 Supabase 自带邮件
    expect(signInWithOtp).not.toHaveBeenCalled();

    delete process.env.EMAIL_MODE;
  });

  it("supabase 模式（默认）：requestCode 走 signInWithOtp，不落地本地验证码", async () => {
    delete process.env.EMAIL_MODE;
    signInWithOtp.mockClear();
    signInWithOtp.mockResolvedValue({ error: null });

    const auth = makeProvider();
    const email = "supabase@test.com";
    const r = await auth.requestCode(email);

    expect(r.ok).toBe(true);
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(signInWithOtp).toHaveBeenCalledWith({
      email,
      options: { shouldCreateUser: true },
    });
    // 不落地本地验证码（与 resend 分支相反）
    expect(await getStoredCode(email)).toBeNull();
  });
});
