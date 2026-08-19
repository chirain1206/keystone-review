import { describe, expect, it } from "vitest";
import {
  collectPaginated,
  getFightEvents,
  MAX_EVENT_PAGES,
  type WclRawEvent,
} from "@/lib/wcl/events";

/**
 * WCL 事件查询验收：
 *  - mock 适配器返回合成玩家事件
 *  - 分页截断标记（≤ MAX_EVENT_PAGES 页）
 */

describe("getFightEvents（mock 合成事件）", () => {
  it("返回所选玩家的施放/爆发/打断/死亡/易伤事件", async () => {
    const r = await getFightEvents({
      code: "mock",
      region: "www",
      fightId: 7,
      playerId: 3,
      fightStartMs: 60_000,
      fightEndMs: 1_710_000,
      isMock: true,
    });
    expect(r.truncated).toBe(false);
    expect(r.events.length).toBeGreaterThan(0);
    const types = new Set(r.events.map((e) => e.type));
    expect(types.has("cast")).toBe(true);
    expect(types.has("interrupt")).toBe(true);
    expect(types.has("death")).toBe(true);
    expect(types.has("applybuff")).toBe(true);
    expect(types.has("removebuff")).toBe(true);
  });

  it("mock 事件时间戳相对 fightStartMs（供对齐逻辑使用）", async () => {
    const r = await getFightEvents({
      code: "mock",
      region: "www",
      fightId: 7,
      playerId: 3,
      fightStartMs: 60_000,
      fightEndMs: 1_710_000,
      isMock: true,
    });
    // 最早事件 ≥ fightStartMs
    const min = Math.min(...r.events.map((e) => e.timestamp));
    expect(min).toBeGreaterThanOrEqual(60_000);
  });
});

describe("collectPaginated（分页截断）", () => {
  const ev = (ts: number): WclRawEvent => ({ timestamp: ts, type: "cast" });

  it("正常结束（nextPageTimestamp=null）不截断", async () => {
    let calls = 0;
    const r = await collectPaginated(undefined, async () => {
      calls++;
      if (calls >= 3) return { events: [ev(calls)], nextPageTimestamp: null };
      return { events: [ev(calls)], nextPageTimestamp: calls * 1000 };
    });
    expect(r.truncated).toBe(false);
    expect(r.events.length).toBe(3);
  });

  it("超过 MAX_EVENT_PAGES 页时打截断标记且只保留前 N 页", async () => {
    const r = await collectPaginated(undefined, async (startTime) => ({
      events: [ev(startTime ?? 0)],
      nextPageTimestamp: (startTime ?? 0) + 1000,
    }));
    expect(r.truncated).toBe(true);
    expect(r.events.length).toBe(MAX_EVENT_PAGES);
  });

  it("首页使用 initialStartTime", async () => {
    let firstStart: number | undefined;
    await collectPaginated(42, async (startTime) => {
      firstStart = startTime;
      return { events: [], nextPageTimestamp: null };
    });
    expect(firstStart).toBe(42);
  });
});
