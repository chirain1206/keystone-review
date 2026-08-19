import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { verifyLink } = vi.hoisted(() => ({ verifyLink: vi.fn() }));

vi.mock("@/lib/auth/provider", () => ({
  createAuthProvider: () => ({ verifyLink }),
}));

import { POST } from "./route";

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  verifyLink.mockReset();
});

/**
 * FR-7 增强：邮箱魔法链接登录路由。
 * 成功建立会话 → 200 ok（透传邮箱 + cookie 头）；失效 → 401；缺参 → 400。
 */
describe("POST /api/auth/verify-link（魔法链接登录）", () => {
  it("成功 → 200 ok，透传用户邮箱，verifyLink 收到 tokenHash + email + source", async () => {
    verifyLink.mockResolvedValue({ ok: true, user: { id: "u1", email: "a@b.com" } });

    const res = await POST(fakeReq({ tokenHash: "tok", email: "a@b.com", source: "code" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.email).toBe("a@b.com");
    expect(verifyLink).toHaveBeenCalledWith("tok", "a@b.com", "code");
  });

  it("无 email 也可成功（token_hash 优先），source 缺省为 undefined", async () => {
    verifyLink.mockResolvedValue({ ok: true, user: { id: "u2", email: "b@c.com" } });

    const res = await POST(fakeReq({ tokenHash: "tok2" }));

    expect(res.status).toBe(200);
    expect(verifyLink).toHaveBeenCalledWith("tok2", undefined, undefined);
  });

  it("source=token_hash 透传给 verifyLink", async () => {
    verifyLink.mockResolvedValue({ ok: true, user: { id: "u3", email: "c@d.com" } });

    const res = await POST(fakeReq({ tokenHash: "tok3", source: "token_hash" }));

    expect(res.status).toBe(200);
    expect(verifyLink).toHaveBeenCalledWith("tok3", undefined, "token_hash");
  });

  it("失效 → 401 且提示链接已失效", async () => {
    verifyLink.mockResolvedValue({ ok: false, error: "链接已失效，请重新登录" });

    const res = await POST(fakeReq({ tokenHash: "bad" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("链接已失效，请重新登录");
  });

  it("缺 tokenHash → 400，不调用 verifyLink", async () => {
    const res = await POST(fakeReq({}));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(verifyLink).not.toHaveBeenCalled();
  });

  it("tokenHash 为空 → 400", async () => {
    const res = await POST(fakeReq({ tokenHash: "" }));
    expect(res.status).toBe(400);
  });

  it("非法 email（可选字段）→ 400", async () => {
    const res = await POST(fakeReq({ tokenHash: "tok", email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("非法 source（非 token_hash/code）→ 400", async () => {
    const res = await POST(fakeReq({ tokenHash: "tok", source: "invalid" }));
    expect(res.status).toBe(400);
    expect(verifyLink).not.toHaveBeenCalled();
  });
});
