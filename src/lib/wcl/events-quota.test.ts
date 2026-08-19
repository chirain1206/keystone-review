import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearEventCache,
  getFightEvents,
  type FightEventsParams,
  type WclRawEvent,
} from "@/lib/wcl/events";
import { clearAbilityNameCache } from "@/lib/wcl/ability-names";

/**
 * WCL 事件拉取配额与容错验收（真实 API 路径，注入 mock fetch）：
 *  - 配额不足（x-ratelimit-remaining < 阈值）跳过后续通道，返回降级标记
 *  - 单通道 429/网络失败保留已拉部分 + truncated 标记，不整体抛错
 *  - abilityGameID/extraAbilityGameID → 名称批量映射回填
 *  - 事件缓存命中不重复请求
 * 真实 WCL 已实测：events.data 返回数组；以下 mock 均按此形态返回。
 */

function params(): FightEventsParams {
  return {
    code: "AbC123",
    region: "www",
    fightId: 11,
    playerId: 413,
    fightStartMs: 1000,
    fightEndMs: 2000,
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function gqlResponse(data: unknown, remaining: number | null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (remaining !== null) headers["x-ratelimit-remaining"] = String(remaining);
  return new Response(JSON.stringify(data), { status: 200, headers });
}

function eventsPayload(events: WclRawEvent[], nextPageTimestamp: number | null = null) {
  return {
    data: {
      reportData: {
        report: { events: { data: events, nextPageTimestamp } },
      },
    },
  };
}

function abilityPayload(map: Record<number, string>) {
  const gameData: Record<string, { id: number; name: string }> = {};
  let i = 0;
  for (const [id, name] of Object.entries(map)) {
    gameData[`a${i++}`] = { id: Number(id), name };
  }
  return { data: { gameData } };
}

beforeEach(() => {
  clearEventCache();
  clearAbilityNameCache();
});

describe("getFightEvents 真实路径（配额与容错）", () => {
  it("配额不足（剩余<阈值）跳过后续通道且返回降级标记，不浪费点数", async () => {
    let eventsCalls = 0;
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) return jsonResponse({ access_token: "tok", token_type: "bearer" });
      const body = JSON.parse(String(init?.body));
      const q = String(body.query ?? "");
      if (q.includes("reportData")) {
        eventsCalls++;
        // 第一通道返回剩余 100（低于阈值 150），后续通道应被跳过
        return gqlResponse(eventsPayload([]), 100);
      }
      return jsonResponse({});
    });

    const r = await getFightEvents(params(), { clientId: "id", clientSecret: "secret", fetchFn });

    expect(r.quotaInsufficient).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.events.length).toBe(0);
    expect(eventsCalls).toBe(1); // 只拉第一通道，后续 4 通道跳过
  });

  it("单通道 429 保留已拉部分 + truncated + quotaInsufficient（不整体抛错）", async () => {
    const castEvents: WclRawEvent[] = [
      { timestamp: 1500, type: "cast", sourceID: 413, abilityGameID: 190319 },
    ];
    let eventsCalls = 0;
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) return jsonResponse({ access_token: "tok" });
      const body = JSON.parse(String(init?.body));
      const q = String(body.query ?? "");
      if (q.includes("reportData")) {
        eventsCalls++;
        if (eventsCalls === 1) return gqlResponse(eventsPayload(castEvents), 300);
        return new Response("too many requests", { status: 429 });
      }
      if (q.includes("gameData")) {
        return gqlResponse(abilityPayload({ 190319: "Combustion" }), null);
      }
      return jsonResponse({});
    });

    const r = await getFightEvents(params(), { clientId: "id", clientSecret: "secret", fetchFn });

    expect(r.events.length).toBe(1); // 第一通道的数据保留
    expect(r.events[0].ability?.name).toBe("Combustion"); // 能力名已回填
    expect(r.truncated).toBe(true);
    expect(r.quotaInsufficient).toBe(true);
    expect(eventsCalls).toBe(2); // 第一通道正常 + 第二通道 429 后停止
  });

  it("能力名映射：abilityGameID/extraAbilityGameID 批量回填名称", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) return jsonResponse({ access_token: "tok" });
      const body = JSON.parse(String(init?.body));
      const q = String(body.query ?? "");
      if (q.includes("reportData")) {
        return gqlResponse(
          eventsPayload([
            {
              timestamp: 1500,
              type: "interrupt",
              sourceID: 413,
              abilityGameID: 47528,
              extraAbilityGameID: 1255377,
            },
          ]),
          700,
        );
      }
      if (q.includes("gameData")) {
        return gqlResponse(abilityPayload({ 47528: "Mind Freeze", 1255377: "Some Cast" }), null);
      }
      return jsonResponse({});
    });

    const r = await getFightEvents(params(), { clientId: "id", clientSecret: "secret", fetchFn });
    const ev = r.events.find((e) => e.type === "interrupt");

    expect(ev).toBeDefined();
    expect(ev!.ability?.name).toBe("Mind Freeze");
    expect(ev!.extraAbility?.name).toBe("Some Cast");
  });

  it("缓存命中不重复请求（同 code/fightId/playerId）", async () => {
    let eventsCalls = 0;
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) return jsonResponse({ access_token: "tok" });
      const body = JSON.parse(String(init?.body));
      const q = String(body.query ?? "");
      if (q.includes("reportData")) {
        eventsCalls++;
        return gqlResponse(
          eventsPayload([{ timestamp: 1500, type: "cast", sourceID: 413, abilityGameID: 190319 }]),
          700,
        );
      }
      if (q.includes("gameData")) {
        return gqlResponse(abilityPayload({ 190319: "Combustion" }), null);
      }
      return jsonResponse({});
    });

    const deps = { clientId: "id", clientSecret: "secret", fetchFn };
    const r1 = await getFightEvents(params(), deps);
    const callsAfterFirst = eventsCalls;
    const r2 = await getFightEvents(params(), deps);

    expect(r1.events.length).toBeGreaterThan(0);
    expect(r2).toEqual(r1); // 缓存返回相同结果
    expect(eventsCalls).toBe(callsAfterFirst); // 第二次未再发请求
  });

  it("events.data 为 JSON 字符串时同样可解析（兼容形态）", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) return jsonResponse({ access_token: "tok" });
      const body = JSON.parse(String(init?.body));
      const q = String(body.query ?? "");
      if (q.includes("reportData")) {
        const payload = eventsPayload([{ timestamp: 1500, type: "cast", sourceID: 413, abilityGameID: 190319 }]);
        // 模拟旧文档形态：events.data 为 JSON 字符串
        return gqlResponse({ data: { reportData: { report: { events: { data: JSON.stringify(payload.data.reportData.report.events.data), nextPageTimestamp: null } } } } }, 700);
      }
      if (q.includes("gameData")) {
        return gqlResponse(abilityPayload({ 190319: "Combustion" }), null);
      }
      return jsonResponse({});
    });

    const r = await getFightEvents(params(), { clientId: "id", clientSecret: "secret", fetchFn });
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.events[0].ability?.name).toBe("Combustion");
  });
});
