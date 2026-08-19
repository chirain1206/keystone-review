import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { NextRequest, NextResponse } from "next/server";
import { SupabaseAuthProvider } from "@/lib/auth/supabase-auth";

/**
 * FR-7 增强：SupabaseAuthProvider.verifyLink（邮箱魔法链接）。
 * 不发真实网络请求：mock @supabase/ssr 的 verifyOtp，断言：
 *  - 成功：用 token_hash 建立会话并写入 profile
 *  - 带 email：一并带上（兼容老版本 gotrue，token_hash 优先）
 *  - 失效 / resend 模式：ok=false，提示链接失效
 */

const { verifyOtp } = vi.hoisted(() => ({ verifyOtp: vi.fn() }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp,
      signInWithOtp: vi.fn(),
      getUser: vi.fn(),
      signOut: vi.fn(),
    },
  }),
}));

const dir = path.join(os.tmpdir(), `wow-analyzer-verify-link-${Date.now()}`);

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

describe("SupabaseAuthProvider.verifyLink（魔法链接）", () => {
  it("成功：verifyOtp 用 token_hash 建立会话并写入 profile", async () => {
    verifyOtp.mockReset();
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.com" } }, error: null });

    const r = await makeProvider().verifyLink("tok");

    expect(r.ok).toBe(true);
    expect(r.user).toEqual({ id: "u1", email: "a@b.com" });
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "tok" });
  });

  it("带 email：verifyOtp 一并带上（兼容老版本 gotrue，token_hash 优先）", async () => {
    verifyOtp.mockReset();
    verifyOtp.mockResolvedValue({ data: { user: { id: "u2", email: "b@c.com" } }, error: null });

    const r = await makeProvider().verifyLink("tok2", "b@c.com");

    expect(r.ok).toBe(true);
    expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "tok2", email: "b@c.com" });
  });

  it("失效：verifyOtp 报错 → ok=false 提示链接失效", async () => {
    verifyOtp.mockReset();
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { status: 403 } });

    const r = await makeProvider().verifyLink("bad");

    expect(r.ok).toBe(false);
    expect(r.error).toBe("链接已失效，请重新登录");
  });

  it("resend 模式：无魔法链接 → 直接失效且不调用 verifyOtp", async () => {
    process.env.EMAIL_MODE = "resend";
    verifyOtp.mockReset();

    const r = await makeProvider().verifyLink("tok");

    expect(r.ok).toBe(false);
    expect(r.error).toBe("链接已失效，请重新登录");
    expect(verifyOtp).not.toHaveBeenCalled();

    delete process.env.EMAIL_MODE;
  });
});
