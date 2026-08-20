import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * FR-7 隐式流增强：POST /api/auth/session-sync（隐式流会话落库）。
 * 不发真实网络请求：mock @supabase/ssr 的 createServerClient（捕获 setAll cookie 桥）
 * 与 @/lib/db 的 getRepo，断言：
 *  - 成功：setSession 用 access_token/refresh_token 建立会话并把会话写入 response cookie
 *    （经 createServerClient 的 setAll 桥 → res.cookies），随后 upsertProfile，返回 200
 *  - setSession 报错 → 401 且不写 profile
 *  - 缺 / 空 accessToken → 400 且不调用 setSession
 */

const h = vi.hoisted(() => ({
  setSession: vi.fn(),
  upsertProfile: vi.fn(),
  capturedSetAll: null as null | ((list: { name: string; value: string; options?: Record<string, unknown> }[]) => void),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies?: {
        getAll?: () => unknown;
        setAll?: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => void;
      };
    },
  ) => {
    if (options?.cookies?.setAll) h.capturedSetAll = options.cookies.setAll;
    return { auth: { setSession: h.setSession } };
  },
}));

vi.mock("@/lib/db", () => ({
  getRepo: () => ({ upsertProfile: h.upsertProfile }),
}));

import { POST } from "./route";

function fakeReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    cookies: { getAll: () => [] },
  } as unknown as NextRequest;
}

beforeEach(() => {
  h.setSession.mockReset();
  h.upsertProfile.mockReset();
  h.capturedSetAll = null;
});

describe("POST /api/auth/session-sync（隐式流会话同步）", () => {
  it("成功：setSession 写入 SSR cookie + upsertProfile + 200", async () => {
    h.setSession.mockImplementation(async () => {
      h.capturedSetAll?.([{ name: "sb-test-auth-token", value: "session-json", options: { path: "/" } }]);
      return { data: { user: { id: "u1", email: "a@b.com" }, session: { access_token: "at" } }, error: null };
    });

    const res = await POST(fakeReq({ accessToken: "at", refreshToken: "rt" }));

    expect(res.status).toBe(200);
    expect(h.setSession).toHaveBeenCalledWith({ access_token: "at", refresh_token: "rt" });
    expect(h.upsertProfile).toHaveBeenCalledWith({ id: "u1", email: "a@b.com", timezone: "Asia/Shanghai" });
    // cookie 经 setAll 桥写入 response（httpOnly SSR cookie 由 createSupabaseServerClient 统一加标记）
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("session-json");
  });

  it("缺 refreshToken 也可成功（refresh_token 空串）", async () => {
    h.setSession.mockResolvedValue({
      data: { user: { id: "u2", email: "b@c.com" }, session: {} },
      error: null,
    });

    const res = await POST(fakeReq({ accessToken: "at" }));

    expect(res.status).toBe(200);
    expect(h.setSession).toHaveBeenCalledWith({ access_token: "at", refresh_token: "" });
    expect(h.upsertProfile).toHaveBeenCalledWith({ id: "u2", email: "b@c.com", timezone: "Asia/Shanghai" });
  });

  it("setSession 报错 → 401 且不写 profile", async () => {
    h.setSession.mockResolvedValue({ data: { user: null, session: null }, error: { status: 401 } });

    const res = await POST(fakeReq({ accessToken: "bad", refreshToken: "rt" }));

    expect(res.status).toBe(401);
    expect(h.upsertProfile).not.toHaveBeenCalled();
  });

  it("缺 accessToken → 400 且不调用 setSession", async () => {
    const res = await POST(fakeReq({ refreshToken: "rt" }));

    expect(res.status).toBe(400);
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it("accessToken 为空 → 400", async () => {
    const res = await POST(fakeReq({ accessToken: "" }));

    expect(res.status).toBe(400);
    expect(h.setSession).not.toHaveBeenCalled();
  });
});
