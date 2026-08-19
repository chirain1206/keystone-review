import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const listMock = vi.fn();

vi.mock("@/lib/kb", () => ({
  getKbStore: () => ({ list: listMock }),
}));
vi.mock("@/lib/auth/provider", () => ({
  getCurrentUser: async () => ({ id: "u1", email: "expert@example.com" }),
}));

import { GET } from "./route";

function fakeReq(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

beforeEach(() => {
  process.env.EXPERT_EMAILS = "expert@example.com";
  listMock.mockReset();
});
afterEach(() => {
  delete process.env.EXPERT_EMAILS;
});

/**
 * 专家知识库浏览接口（只读）：白名单门禁 + 转发 patch/status/class 过滤到
 * KbStore.list，并在服务端做关键词与 limit 收敛。
 */
describe("GET /api/kb/list", () => {
  it("白名单：转发过滤参数并做关键词+limit 收敛", async () => {
    listMock.mockResolvedValue([
      { id: "a", chunkText: "火焰法师爆发规划。", meta: { class: "Mage", spec: "Fire", status: "active" } },
      { id: "b", chunkText: "兽王猎人爆发。", meta: { class: "Hunter", spec: "Beast Mastery", status: "active" } },
    ]);
    const res = await GET(fakeReq("http://x/api/kb/list?class=Mage&status=active&q=火焰&limit=1"));
    expect(listMock).toHaveBeenCalledWith({ class: "Mage", status: "active" });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("a");
  });

  it("非白名单 → 403", async () => {
    process.env.EXPERT_EMAILS = "other@example.com";
    const res = await GET(fakeReq("http://x/api/kb/list"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});
