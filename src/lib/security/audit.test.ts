import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { NextRequest } from "next/server";
import { getRepo, resetRepoForTest } from "@/lib/db";

/**
 * T13 安全审计测试（非功能需求安全清单）：
 *  1. 未登录访问受保护接口一律 401
 *  2. 用户 A 无法通过接口访问用户 B 的数据（404，不泄露存在性）
 *  3. 结构化数据 token 预算服务端再校验（413）
 *
 * 注：用最小 fake request 代替 next/server 的 NextRequest 实例，
 * 避免测试图引入 next/server 的依赖外部化（沙箱内子进程受限）。
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-sec-test-${Date.now()}`);

vi.unmock("@/lib/auth/provider");

beforeAll(() => {
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  resetRepoForTest();
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  resetRepoForTest();
  vi.resetModules();
});

/** 路由处理器只需要 cookies.get / headers.get / json() 这三个面。 */
function fakeReq(body?: unknown): NextRequest {
  return {
    cookies: { get: () => undefined },
    headers: { get: (k: string) => (k === "x-forwarded-for" ? "1.2.3.4" : null) },
    json: async () => body ?? {},
  } as unknown as NextRequest;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function expect401(
  handler: (r: NextRequest, ctx: any) => Promise<Response>,
  url: string,
  method: string,
  body?: unknown,
): Promise<void> {
  const ctx = { params: Promise.resolve({ id: "some-id", n: "2" }) };
  const res = await handler(fakeReq(body), ctx);
  expect(res.status, `${method} ${url} 未登录应 401，实得 ${res.status}`).toBe(401);
}

describe("未登录访问受保护接口一律 401（T13）", () => {
  it("全部受保护路由在无会话时返回 401", async () => {
    const reports = await import("@/app/api/reports/route");
    const reportId = await import("@/app/api/reports/[id]/route");
    const fromLink = await import("@/app/api/reports/from-link/route");
    const generate = await import("@/app/api/reports/[id]/generate/route");
    const chapters = await import("@/app/api/reports/[id]/chapters/[n]/route");
    const qa = await import("@/app/api/reports/[id]/qa/route");
    const share = await import("@/app/api/reports/[id]/share/route");

    const ctx = { params: Promise.resolve({ id: "some-id", n: "2" }) };

    await expect401(reports.GET, "/api/reports", "GET");
    await expect401(reports.POST, "/api/reports", "POST", {});
    await expect401(fromLink.POST, "/api/reports/from-link", "POST", {});
    await expect401(reportId.GET, "/api/reports/some-id", "GET");
    await expect401(reportId.DELETE, "/api/reports/some-id", "DELETE");
    await expect401(generate.POST, "/api/reports/some-id/generate", "POST");
    await expect401(chapters.POST, "/api/reports/some-id/chapters/2", "POST");
    await expect401(qa.POST, "/api/reports/some-id/qa", "POST", { question: "hi" });
    await expect401(share.POST, "/api/reports/some-id/share", "POST");
    await expect401(share.DELETE, "/api/reports/some-id/share", "DELETE");

    void ctx;
  });
});

describe("接口层数据隔离（用户 A 无法访问用户 B）", () => {
  it("用户 B 请求用户 A 的报告详情 → 404", async () => {
    // 造一份用户 A 的报告
    const repo = getRepo();
    const r = await repo.createReport({
      userId: "user-a",
      sourceType: "file",
      dungeon: "Grim Batol",
      level: 12,
      spec: "Fire",
      playerName: "Mymage",
      playerClass: "Mage",
      result: true,
    });

    // mock 登录态为用户 B
    vi.doMock("@/lib/auth/provider", () => ({
      getCurrentUser: async () => ({ id: "user-b", email: "b@test.com" }),
      createAuthProvider: () => {
        throw new Error("not used in this test");
      },
    }));
    const { GET, DELETE } = await import("@/app/api/reports/[id]/route");
    const res = await GET(fakeReq(), {
      params: Promise.resolve({ id: r.id }),
    });
    expect(res.status).toBe(404);
    const del = await DELETE(fakeReq(), {
      params: Promise.resolve({ id: r.id }),
    });
    expect(del.status).toBe(404);
    // 用户 A 的报告仍存在
    expect(await repo.getReportById(r.id)).not.toBeNull();
  });
});

describe("token 预算服务端再校验（FR-10，T13）", () => {
  it("超过 50K token 的结构化数据 → 413", async () => {
    vi.doMock("@/lib/auth/provider", () => ({
      getCurrentUser: async () => ({ id: "user-t", email: "t@test.com" }),
      createAuthProvider: () => {
        throw new Error("not used in this test");
      },
    }));
    const { POST } = await import("@/app/api/reports/route");

    // 构造合法结构但序列化后远超 150K 字符的 log
    const bigTimeline = Array.from({ length: 4000 }, (_, i) => ({
      t: i,
      ts: "5/16 21:00:00.000",
      type: "cast",
      actor: "Mymage",
      spell: `SpellNumber${i}WithALongEnglishNamePadding`,
    }));
    const log = {
      version: 1,
      source: "file",
      combat: {
        dungeon: "Grim Batol",
        level: 12,
        startTime: 0,
        endTime: 1000,
        durationSec: 1000,
        success: true,
        players: [{ name: "Mymage", class: "Mage", spec: "Fire", role: "dps" }],
        playerName: "Mymage",
        playerClass: "Mage",
        playerSpec: "Fire",
      },
      timeline: bigTimeline,
      aggregate: {
        interrupts: [],
        deaths: [],
        cooldowns: [],
        vulnerablePhases: [],
        movement: [],
        perMinute: [],
      },
    };
    const res = await POST(
      fakeReq({ log, rawSize: 1_000_000, rawLines: 5000, tokenEstimate: 0 }),
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain("token 预算");
  });

  it("预算内数据不受影响（mock 用户可创建）", async () => {
    vi.doMock("@/lib/auth/provider", () => ({
      getCurrentUser: async () => ({ id: "user-t2", email: "t2@test.com" }),
      createAuthProvider: () => {
        throw new Error("not used in this test");
      },
    }));
    const { POST } = await import("@/app/api/reports/route");
    const log = {
      version: 1,
      source: "file",
      combat: {
        dungeon: "Grim Batol",
        level: 12,
        startTime: 0,
        endTime: 1000,
        durationSec: 1000,
        success: true,
        players: [{ name: "Mymage", class: "Mage", spec: "Fire", role: "dps" }],
        playerName: "Mymage",
        playerClass: "Mage",
        playerSpec: "Fire",
      },
      timeline: [],
      aggregate: {
        interrupts: [],
        deaths: [],
        cooldowns: [],
        vulnerablePhases: [],
        movement: [],
        perMinute: [],
      },
    };
    const res = await POST(
      fakeReq({ log, rawSize: 100, rawLines: 2, tokenEstimate: 0 }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
