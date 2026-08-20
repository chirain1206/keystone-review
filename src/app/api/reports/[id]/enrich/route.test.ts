import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * FR-1 两步式创建：POST /api/reports/:id/enrich（拉取事件级数据 + 对比基准，覆盖占位日志）。
 * 不发真实网络请求：mock auth/db/wcl 模块，断言：
 *  - 未登录 401；报告不存在 404
 *  - 占位日志无 enrich 标记 → already（幂等，不拉数据）
 *  - 有 enrich → 拉事件+对比，保存完整日志，写入 compareMeta，返回降级标记
 *  - 主链接元数据失败 → 502 且不保存
 */

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getReport: vi.fn(),
  getProcessedLogByReportId: vi.fn(),
  saveProcessedLog: vi.fn(),
  updateReportCompareMeta: vi.fn(),
  getWclReportMeta: vi.fn(),
  getCompareBaseline: vi.fn(),
  selectFight: vi.fn(),
  getFightEvents: vi.fn(),
  buildProcessedLogFromWcl: vi.fn(),
  buildPlaceholderLinkLog: vi.fn(),
}));

vi.mock("@/lib/auth/provider", () => ({
  getCurrentUser: (...args: unknown[]) => h.getCurrentUser(...args),
}));

vi.mock("@/lib/db", () => ({
  getRepo: () => ({
    getReport: h.getReport,
    getProcessedLogByReportId: h.getProcessedLogByReportId,
    saveProcessedLog: h.saveProcessedLog,
    updateReportCompareMeta: h.updateReportCompareMeta,
  }),
}));

vi.mock("@/lib/wcl/adapter", () => ({
  getWclReportMeta: (...args: unknown[]) => h.getWclReportMeta(...args),
  getCompareBaseline: (...args: unknown[]) => h.getCompareBaseline(...args),
  selectFight: (...args: unknown[]) => h.selectFight(...args),
}));

vi.mock("@/lib/wcl/players", () => ({
  applyFightSpecs: (players: unknown[]) => players,
  filterPlayersByFight: (players: unknown[]) => players,
}));

vi.mock("@/lib/wcl/events", () => ({
  getFightEvents: (...args: unknown[]) => h.getFightEvents(...args),
}));

vi.mock("@/lib/wcl/to-processed", () => ({
  buildProcessedLogFromWcl: (...args: unknown[]) => h.buildProcessedLogFromWcl(...args),
  buildPlaceholderLinkLog: (...args: unknown[]) => h.buildPlaceholderLinkLog(...args),
}));

vi.mock("@/lib/ai/tokens", () => ({
  estimateProcessedLogTokens: () => 42,
}));

import { POST } from "./route";

function fakeReq(): NextRequest {
  return { json: async () => ({}) } as unknown as NextRequest;
}

const params = () => Promise.resolve({ id: "r1" });

const fight = { id: 3, name: "暗焰裂口", keystoneLevel: 12, success: true, durationSec: 1800, startTime: 0, endTime: 1800000, friendlyPlayers: [1], friendlySpecs: ["Fire"] };
const player = { id: 1, name: "Hero", class: "Mage", spec: "Fire", role: "dps" };
const metaOk = { ok: true, meta: { code: "AbCd", isMock: false, title: "t", players: [player], uploaderName: "Hero", fights: [fight] } };
const pending = { url: "https://www.warcraftlogs.com/reports/AbCd", fightId: 3, playerId: 1, region: "www", compareUrl: "https://www.warcraftlogs.com/reports/XyZw" };

const fakeLog = { version: 1, source: "link", combat: {}, timeline: [], aggregate: {} };

beforeEach(() => {
  vi.clearAllMocks();
  h.getCurrentUser.mockResolvedValue({ id: "u1", email: "a@b.com" });
  h.getReport.mockResolvedValue({ id: "r1", userId: "u1", status: "parsed" });
  h.selectFight.mockReturnValue(fight);
  h.buildProcessedLogFromWcl.mockReturnValue(fakeLog);
  h.buildPlaceholderLinkLog.mockReturnValue(fakeLog);
  h.getWclReportMeta.mockResolvedValue(metaOk);
  h.getFightEvents.mockResolvedValue({ events: [{ timestamp: 1 }], truncated: false });
  h.getCompareBaseline.mockResolvedValue({
    ok: true,
    meta: { title: "顶尖法师", code: "XyZw", fights: [{ name: "暗焰裂口", keystoneLevel: 13, success: true }] },
  });
});

describe("POST /api/reports/:id/enrich（两步式第二步）", () => {
  it("未登录 → 401", async () => {
    h.getCurrentUser.mockResolvedValue(null);
    const res = await POST(fakeReq(), { params: params() });
    expect(res.status).toBe(401);
  });

  it("报告不存在 → 404", async () => {
    h.getReport.mockResolvedValue(null);
    const res = await POST(fakeReq(), { params: params() });
    expect(res.status).toBe(404);
  });

  it("无 enrich 标记 → already 且不拉事件（幂等）", async () => {
    h.getProcessedLogByReportId.mockResolvedValue({ reportId: "r1", log: { ...fakeLog }, rawSize: 0, rawLines: 0, tokenEstimate: 0, createdAt: 0 });
    const res = await POST(fakeReq(), { params: params() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.already).toBe(true);
    expect(h.getFightEvents).not.toHaveBeenCalled();
  });

  it("有 enrich：拉事件+对比 → 保存完整日志与 compareMeta → 200", async () => {
    h.getProcessedLogByReportId.mockResolvedValue({ reportId: "r1", log: { ...fakeLog, enrich: pending }, rawSize: 0, rawLines: 0, tokenEstimate: 0, createdAt: 0 });

    const res = await POST(fakeReq(), { params: params() });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.dataInsufficient).toBe(false);
    expect(body.compareDegraded).toBe(false);
    expect(h.getFightEvents).toHaveBeenCalledWith(
      expect.objectContaining({ code: "AbCd", region: "www", fightId: 3, playerId: 1 }),
    );
    expect(h.saveProcessedLog).toHaveBeenCalledWith(expect.objectContaining({ reportId: "r1", log: fakeLog }));
    expect(h.updateReportCompareMeta).toHaveBeenCalledWith("r1", expect.objectContaining({ url: pending.compareUrl }));
  });

  it("有 enrich 但事件为空 → 降级占位日志 + dataInsufficient", async () => {
    h.getProcessedLogByReportId.mockResolvedValue({ reportId: "r1", log: { ...fakeLog, enrich: pending }, rawSize: 0, rawLines: 0, tokenEstimate: 0, createdAt: 0 });
    h.getFightEvents.mockResolvedValue({ events: [], truncated: false });

    const res = await POST(fakeReq(), { params: params() });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.dataInsufficient).toBe(true);
    expect(h.buildPlaceholderLinkLog).toHaveBeenCalled();
    expect(h.buildProcessedLogFromWcl).not.toHaveBeenCalled();
  });

  it("主链接元数据失败 → 502 且不保存", async () => {
    h.getProcessedLogByReportId.mockResolvedValue({ reportId: "r1", log: { ...fakeLog, enrich: pending }, rawSize: 0, rawLines: 0, tokenEstimate: 0, createdAt: 0 });
    h.getWclReportMeta.mockResolvedValue({ ok: false, code: "FETCH_FAILED", message: "WCL 暂时不可用" });

    const res = await POST(fakeReq(), { params: params() });

    expect(res.status).toBe(502);
    expect(h.saveProcessedLog).not.toHaveBeenCalled();
  });
});
