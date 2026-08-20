import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const createMock = vi.fn();
const listMock = vi.fn();
const getMock = vi.fn();
const updateStatusMock = vi.fn();
const getCurrentUserMock = vi.fn();
const verifyTurnstileMock = vi.fn();

vi.mock("@/lib/feedback", () => ({
  getFeedbackStore: () => ({
    create: createMock,
    list: listMock,
    get: getMock,
    updateStatus: updateStatusMock,
  }),
}));
vi.mock("@/lib/auth/provider", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
}));
vi.mock("@/lib/turnstile/adapter", () => ({
  verifyTurnstile: (...args: unknown[]) => verifyTurnstileMock(...args),
}));

import { GET, PATCH, POST } from "./route";
import { resetRateLimiterForTest } from "@/lib/auth/guard";

function fakeGet(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

function fakeJson(url: string, body: unknown, ip = "1.2.3.4"): NextRequest {
  return {
    nextUrl: new URL(url),
    headers: new Headers({ "x-forwarded-for": ip }),
    json: async () => body,
  } as unknown as NextRequest;
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  userId: null,
  email: null,
  category: "suggestion",
  content: "内容",
  pageUrl: "/",
  status: "new",
  createdAt: 1700000000000,
  ...over,
});

beforeEach(() => {
  process.env.EXPERT_EMAILS = "expert@example.com";
  resetRateLimiterForTest();
  createMock.mockReset().mockResolvedValue({ id: "f1" });
  listMock.mockReset().mockResolvedValue([]);
  getMock.mockReset().mockResolvedValue(null);
  updateStatusMock.mockReset().mockResolvedValue(true);
  getCurrentUserMock.mockReset().mockResolvedValue({ id: "u1", email: "expert@example.com" });
  verifyTurnstileMock.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  delete process.env.EXPERT_EMAILS;
});

/**
 * FEEDBACK 接口验收：
 *  - POST 公开提交（校验 / Turnstile / IP 频控 / 写入）
 *  - GET 专家白名单列表（status 过滤）
 *  - PATCH 状态流转（new→read→resolved）
 */
describe("POST /api/feedback（公开提交）", () => {
  it("合法提交 → 写入并返回 ok", async () => {
    const res = await POST(
      fakeJson("http://x/api/feedback", {
        category: "bug",
        content: "崩溃了",
        email: "A@B.com",
        page_url: "/",
        turnstileToken: "t",
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.id).toBe("f1");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "bug",
        content: "崩溃了",
        email: "a@b.com",
        pageUrl: "/",
      }),
    );
  });

  it("非法 body → 400，不写库", async () => {
    const res = await POST(fakeJson("http://x/api/feedback", { category: "bug", content: "" }));
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("Turnstile 校验失败 → 403", async () => {
    verifyTurnstileMock.mockResolvedValue({ ok: false, error: "人机验证未通过" });
    const res = await POST(fakeJson("http://x/api/feedback", { category: "bug", content: "x" }));
    expect(res.status).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("同一 IP 每分钟超过 3 条 → 429", async () => {
    const make = () =>
      POST(fakeJson("http://x/api/feedback", { category: "bug", content: "x" }, "9.9.9.9"));
    for (let i = 0; i < 3; i++) {
      expect((await make()).status).toBe(200);
    }
    const blocked = await make();
    expect(blocked.status).toBe(429);
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it("访客（未登录）也能提交，user_id 为空", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await POST(fakeJson("http://x/api/feedback", { category: "suggestion", content: "建议" }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });
});

describe("GET /api/feedback（专家白名单）", () => {
  it("白名单：返回 items 并转发 status 过滤", async () => {
    listMock.mockResolvedValue([row()]);
    const res = await GET(fakeGet("http://x/api/feedback?status=new"));
    expect(listMock).toHaveBeenCalledWith({ status: "new", limit: 100 });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(1);
  });

  it("非白名单 → 403", async () => {
    process.env.EXPERT_EMAILS = "other@example.com";
    const res = await GET(fakeGet("http://x/api/feedback"));
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/feedback（状态流转）", () => {
  it("new→read 成功", async () => {
    getMock.mockResolvedValue(row({ status: "new" }));
    const res = await PATCH(fakeJson("http://x/api/feedback", { id: "f1", status: "read" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(updateStatusMock).toHaveBeenCalledWith("f1", "read");
  });

  it("跳级流转（new→resolved）→ 400", async () => {
    getMock.mockResolvedValue(row({ status: "new" }));
    const res = await PATCH(fakeJson("http://x/api/feedback", { id: "f1", status: "resolved" }));
    expect(res.status).toBe(400);
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  it("不存在的 id → 404", async () => {
    getMock.mockResolvedValue(null);
    const res = await PATCH(fakeJson("http://x/api/feedback", { id: "nope", status: "read" }));
    expect(res.status).toBe(404);
  });

  it("非白名单 → 403", async () => {
    process.env.EXPERT_EMAILS = "other@example.com";
    const res = await PATCH(fakeJson("http://x/api/feedback", { id: "f1", status: "read" }));
    expect(res.status).toBe(403);
  });
});
