import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/provider", () => ({
  createAuthProvider: () => ({
    getSession: async () => ({ id: "u1", email: "expert@example.com" }),
  }),
}));

import { GET } from "./route";

function fakeReq(): NextRequest {
  return {} as unknown as NextRequest;
}

beforeEach(() => {
  process.env.EXPERT_EMAILS = "expert@example.com";
});
afterEach(() => {
  delete process.env.EXPERT_EMAILS;
});

/**
 * 专家入口显隐（FR-11 增强）：/api/auth/me 返回 isExpert 标记，
 * 客户端 TopBar 据此显示「知识库」入口（仅白名单可见）。
 */
describe("GET /api/auth/me（专家标记）", () => {
  it("白名单用户 → isExpert=true", async () => {
    const res = await GET(fakeReq());
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.isExpert).toBe(true);
  });

  it("非白名单用户 → isExpert=false", async () => {
    process.env.EXPERT_EMAILS = "other@example.com";
    const res = await GET(fakeReq());
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.isExpert).toBe(false);
  });
});
