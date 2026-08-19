import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ageInDays,
  clearSearchCache,
  dedupeByCode,
  extractSpecPercents,
  filterByLevelRange,
  limitEntries,
  maxAgeDays,
  normalizeSpec,
  parseRankingEntries,
  RANKING_CANDIDATE_LIMIT,
  rangeLevels,
  rankByRecency,
  rankRecommendations,
  rankingMetric,
  recencyDays,
  recommendReferences,
  sortByAmountDesc,
  specMatchesTeam,
  wclSlug,
} from "@/lib/wcl/rankings";
import { clearDungeonZoneCache } from "@/lib/wcl/dungeon-zones";
import { clearNpcNameCache } from "@/lib/wcl/npc-names";
import { buildCompProfile } from "@/lib/route/comp-profile";

const USER_COMP = buildCompProfile([
  { class: "Warrior", spec: "Protection" },
  { class: "Shaman", spec: "Restoration" },
  { class: "Mage", spec: "Fire" },
  { class: "Rogue", spec: "Assassination" },
  { class: "Druid", spec: "Balance" },
]);

function entry(code: string, over: Record<string, unknown> = {}) {
  return {
    code,
    fightId: null as number | null,
    level: 15 as number | null,
    durationSec: 100,
    amount: null as number | null,
    score: null as number | null,
    medal: null as string | null,
    metricName: null as string | null,
    ...over,
  };
}

describe("parseRankingEntries（真实结构：{ rankings: [...] } 包裹）", () => {
  it("解析 report.code / fightID / hardModeLevel / amount / score / medal", () => {
    const entries = parseRankingEntries({
      page: 1,
      hasMorePages: true,
      count: 100,
      rankings: [
        {
          name: "Faoln",
          class: "Monk",
          spec: "Windwalker",
          amount: 310042.28,
          hardModeLevel: 10,
          duration: 1076566,
          score: 335,
          medal: "gold",
          report: { code: "Cw8GavzArQ9nKBDZ", fightID: 67 },
        },
      ],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].code).toBe("Cw8GavzArQ9nKBDZ");
    expect(entries[0].fightId).toBe(67);
    expect(entries[0].level).toBe(10);
    expect(entries[0].amount).toBeCloseTo(310042.28, 2);
    expect(entries[0].score).toBe(335);
    expect(entries[0].medal).toBe("gold");
  });

  it("{ error } 返回空；缺 code 的条目跳过；非对象返回空", () => {
    expect(parseRankingEntries({ error: "Invalid class and spec specified." })).toEqual([]);
    expect(parseRankingEntries([{ noCode: true }])).toEqual([]);
    expect(parseRankingEntries(null)).toEqual([]);
  });

  it("兼容顶层 reportID/keystoneLevel（fightRankings 降级路径）", () => {
    const entries = parseRankingEntries({
      rankings: [{ reportID: "TOP123", keystoneLevel: 15, duration: 1_500_000, amount: 100 }],
    });
    expect(entries[0].code).toBe("TOP123");
    expect(entries[0].level).toBe(15);
  });

  it("bracketData 兜底层数", () => {
    const entries = parseRankingEntries({
      rankings: [{ report: { code: "X", fightID: 1 }, bracketData: 11, amount: 1 }],
    });
    expect(entries[0].level).toBe(11);
  });
});

describe("extractSpecPercents（Key %/Parse %）", () => {
  const rankings = {
    data: [
      {
        fightID: 19,
        roles: {
          dps: {
            characters: [
              { name: "X", spec: "Arcane", amount: 1, bracketPercent: 88, rankPercent: 96 },
              { name: "Meditalis", spec: "Windwalker", amount: 232505, bracketPercent: 92, rankPercent: 97 },
            ],
          },
        },
      },
    ],
  };

  it("从 roles.*.characters 中提取该专精的 bracketPercent(Key %)/rankPercent(Parse %)", () => {
    expect(extractSpecPercents(rankings, "Windwalker")).toEqual({ keyPercent: 92, parsePercent: 97 });
  });

  it("0 视为未计算 → null（交由 DPS 兜底）", () => {
    const r = { data: [{ roles: { dps: { characters: [{ spec: "Windwalker", bracketPercent: 0, rankPercent: 0 }] } } }] };
    expect(extractSpecPercents(r, "Windwalker")).toEqual({ keyPercent: null, parsePercent: null });
  });

  it("结构缺失/专精未知 → null", () => {
    expect(extractSpecPercents(null, "Windwalker")).toEqual({ keyPercent: null, parsePercent: null });
    expect(extractSpecPercents(rankings, "Unknown")).toEqual({ keyPercent: null, parsePercent: null });
  });

  it("从 healers 角色也能提取（治疗专精）", () => {
    const r = { data: [{ roles: { healers: { characters: [{ spec: "Restoration", bracketPercent: 83, rankPercent: 97 }] } } }] };
    expect(extractSpecPercents(r, "Restoration")).toEqual({ keyPercent: 83, parsePercent: 97 });
  });

  it("多角色同名专精取首个匹配", () => {
    const r = { data: [{ roles: { dps: { characters: [{ spec: "Fire", bracketPercent: 10 }, { spec: "Fire", bracketPercent: 90 }] } } }] };
    expect(extractSpecPercents(r, "Fire")).toEqual({ keyPercent: 10, parsePercent: null });
  });
});

describe("层数范围 / 去重 / N 上限 / DPS 降序", () => {
  it("filterByLevelRange 按 [level-range, level+range] 过滤，未知层数保留", () => {
    const entries = [entry("a", { level: 14 }), entry("b", { level: 15 }), entry("c", { level: 17 }), entry("d", { level: null })];
    expect(filterByLevelRange(entries, 15, 1).map((x) => x.code)).toEqual(["a", "b", "d"]);
  });

  it("dedupeByCode 去重保留首个", () => {
    const entries = [entry("a"), entry("b"), entry("a", { level: 16 })];
    expect(dedupeByCode(entries).map((x) => x.code)).toEqual(["a", "b"]);
  });

  it("limitEntries 取前 N", () => {
    const entries = Array.from({ length: 20 }, (_, i) => entry(`c${i}`));
    expect(limitEntries(entries, RANKING_CANDIDATE_LIMIT)).toHaveLength(RANKING_CANDIDATE_LIMIT);
    expect(RANKING_CANDIDATE_LIMIT).toBeLessThanOrEqual(10);
  });

  it("sortByAmountDesc：DPS 降序，null 排最后", () => {
    const entries = [entry("a"), entry("b", { amount: 11_000 }), entry("c", { amount: 12_345 }), entry("d", { amount: 9_800 })];
    expect(sortByAmountDesc(entries).map((x) => x.code)).toEqual(["c", "b", "d", "a"]);
  });
});

describe("rankRecommendations（Key % 优先，相似度其次）", () => {
  const item = (id: string, keyPercent: number | null, amount: number | null, route: number | null, comp: number | null) => ({
    id,
    keyPercent,
    amount,
    routeSimilarity: route,
    compSimilarity: comp,
  });

  it("主排序 Key % 降序，Key % 相同时 DPS 兜底，再比路线/阵容", () => {
    const items = [
      item("a", 88, 11_000, 0.8, 0.9),
      item("b", 95, 9_000, 0.1, 0.1),
      item("c", 88, 13_000, 0.9, 0.5),
      item("d", 88, 13_000, 0.9, 0.8),
    ];
    expect(rankRecommendations(items).map((x) => x.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("无 Key %（null）排最后，仅按 DPS/相似度排序", () => {
    const items = [
      item("a", null, 9_000, 0.9, 0.5),
      item("b", 92, 5_000, 0.1, 0.1),
      item("c", null, 13_000, 0.9, 0.8),
    ];
    expect(rankRecommendations(items).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("Key % 与 DPS 均缺失时按路线/阵容排序", () => {
    const items = [
      item("a", null, null, 0.8, 0.9),
      item("b", null, null, 0.9, 0.5),
      item("c", null, null, 0.9, 0.8),
    ];
    expect(rankRecommendations(items).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
});

describe("专精/职业过滤", () => {
  it("normalizeSpec / wclSlug / specMatchesTeam", () => {
    expect(normalizeSpec("Beast Mastery")).toBe("beastmastery");
    expect(wclSlug("Death Knight")).toBe("DeathKnight");
    expect(specMatchesTeam(["Protection", "Restoration", "Fire"], "Fire")).toBe(true);
    expect(specMatchesTeam(["Protection", "Restoration", "Fire"], "Beast Mastery")).toBe(false);
    expect(specMatchesTeam(["Fire"], "Unknown")).toBe(true);
  });
});

describe("环境变量配置", () => {
  const prev = {
    range: process.env.RANGE_LEVELS,
    metric: process.env.RANKING_METRIC,
    recency: process.env.RECENCY_DAYS,
    maxAge: process.env.MAX_AGE_DAYS,
  };
  afterEach(() => {
    for (const [k, v] of Object.entries({
      RANGE_LEVELS: prev.range,
      RANKING_METRIC: prev.metric,
      RECENCY_DAYS: prev.recency,
      MAX_AGE_DAYS: prev.maxAge,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("rangeLevels 缺省 1；rankingMetric 缺省 dps", () => {
    delete process.env.RANGE_LEVELS;
    delete process.env.RANKING_METRIC;
    expect(rangeLevels()).toBe(1);
    expect(rankingMetric()).toBe("dps");
  });

  it("recencyDays 缺省 14；maxAgeDays 缺省 30；非法值回退", () => {
    delete process.env.RECENCY_DAYS;
    delete process.env.MAX_AGE_DAYS;
    expect(recencyDays()).toBe(14);
    expect(maxAgeDays()).toBe(30);
    process.env.RECENCY_DAYS = "abc";
    process.env.MAX_AGE_DAYS = "-5";
    expect(recencyDays()).toBe(14);
    expect(maxAgeDays()).toBe(30);
  });
});

describe("候选时效性：ageInDays / rankByRecency", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date("2026-08-20T12:00:00Z").getTime();
  const item = (id: string, fightStartTimeMs: number | null) => ({ id, fightStartTimeMs });

  it("ageInDays：正常 / 未知 / 非法 / 未来 → null", () => {
    expect(ageInDays(now - 3 * DAY, now)).toBeCloseTo(3, 5);
    expect(ageInDays(null, now)).toBeNull();
    expect(ageInDays(0, now)).toBeNull();
    expect(ageInDays(now + DAY, now)).toBeNull(); // 未来时间视为未知
  });

  it("新候选保持原顺序；较早候选排后并标注 stale；超龄过滤", () => {
    const ranked = [
      item("fresh2", now - 2 * DAY), // 2 天 → fresh
      item("stale1", now - 20 * DAY), // 20 天 → stale
      item("fresh1", now - 1 * DAY), // 1 天 → fresh
      item("tooOld", now - 40 * DAY), // 40 天 → 过滤
      item("unknown", null), // 未知 → fresh
    ];
    const out = rankByRecency(ranked, { nowMs: now, recencyDays: 14, maxAgeDays: 30 });
    expect(out.map((r) => r.item.id)).toEqual(["fresh2", "fresh1", "unknown", "stale1"]);
    expect(out.map((r) => r.recency)).toEqual(["fresh", "fresh", "fresh", "stale"]);
    expect(out.find((r) => r.item.id === "tooOld")).toBeUndefined();
  });

  it("边界：age ≤ recencyDays 视为新；age > maxAgeDays 过滤", () => {
    const ranked = [
      item("at14", now - 14 * DAY), // 恰 14 天 → fresh（≤ RECENCY_DAYS）
      item("at30", now - 30 * DAY), // 恰 30 天 → stale（≤ MAX_AGE_DAYS）
      item("over30", now - (30 * DAY + 1)), // 超 30 → 过滤
    ];
    const out = rankByRecency(ranked, { nowMs: now, recencyDays: 14, maxAgeDays: 30 });
    expect(out.map((r) => r.item.id)).toEqual(["at14", "at30"]);
    expect(out.map((r) => r.recency)).toEqual(["fresh", "stale"]);
  });
});

describe("recommendReferences（mock 分支：Key % 优先排序）", () => {
  it("主排序按 Key % 降序（即便该候选相似度更低）+ 链接带 #fight", async () => {
    const r = await recommendReferences(
      { dungeon: "Ruby Life Pools", level: 15, spec: "Fire", playerClass: "Mage", region: "www", userRoute: null, userComp: USER_COMP, isMock: true },
      {},
    );
    expect(r.ok).toBe(true);
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates[0].code).toBe("MOCK3"); // Key % 最高 95
    expect(r.candidates[0].keyPercent).toBe(95);
    const kp = r.candidates.map((c) => c.keyPercent ?? -1);
    expect([...kp].sort((a, b) => b - a)).toEqual(kp);
    expect(r.candidates[0].url).toContain("warcraftlogs.com/reports/MOCK3#fight=");
    expect(r.candidates.every((c) => c.routeSimilarity === null)).toBe(true);
    expect(r.candidates[0].parsePercent).toBe(99);
    expect(r.candidates.every((c) => c.url.includes("#fight="))).toBe(true);
  });
});

describe("recommendReferences（真实路径：缓存命中不重复请求）", () => {
  function makeFakeFetch() {
    const queries: string[] = [];
    const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body ?? "{}"));
      const query: string = body.query ?? "";
      queries.push(query);
      if (query.includes("CharacterRankings")) {
        return new Response(
          JSON.stringify({
            data: {
              worldData: {
                encounter: {
                  characterRankings: {
                    page: 1,
                    rankings: [
                      { name: "Faoln", class: "Mage", spec: "Fire", amount: 310_042, hardModeLevel: 15, duration: 1_500_000, score: 335, medal: "gold", report: { code: "ABC123", fightID: 7 } },
                    ],
                  },
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (query.includes("ReportDetail")) {
        return new Response(
          JSON.stringify({
            data: {
              reportData: {
                report: {
                  fights: [
                    {
                      id: 7,
                      name: "Ruby Life Pools",
                      keystoneLevel: 15,
                      kill: true,
                      startTime: 0,
                      endTime: 1_500_000,
                      friendlyPlayers: [1, 2, 3, 4, 5],
                      friendlySpecs: ["Protection", "Restoration", "Fire", "Assassination", "Balance"],
                      dungeonPulls: [{ id: 1, name: "P1", encounterID: 0, startTime: 0, endTime: 30_000, enemyNPCs: [{ id: 11, gameID: 111 }] }],
                    },
                  ],
                  masterData: {
                    actors: [
                      { id: 1, name: "Tank", subType: "Warrior", type: "Player" },
                      { id: 2, name: "Healer", subType: "Shaman", type: "Player" },
                      { id: 3, name: "Mage", subType: "Mage", type: "Player" },
                      { id: 4, name: "Rogue", subType: "Rogue", type: "Player" },
                      { id: 5, name: "Druid", subType: "Druid", type: "Player" },
                    ],
                  },
                  rankings: {
                    data: [{ roles: { dps: { characters: [{ spec: "Fire", bracketPercent: 92, rankPercent: 96 }] } } }],
                  },
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (query.includes("NpcNames")) {
        return new Response(JSON.stringify({ data: { gameData: { n0: { id: 111, name: "Mistcaller" } } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    return { fetchFn, queries };
  }

  afterEach(() => {
    clearSearchCache();
    clearDungeonZoneCache();
    clearNpcNameCache();
  });

  it("第二次调用不再请求 characterRankings，且解析出 Key %", async () => {
    const { fetchFn, queries } = makeFakeFetch();
    const deps = { fetchFn, clientId: "id", clientSecret: "secret" };
    const input = { dungeon: "Ruby Life Pools", level: 15, spec: "Fire", playerClass: "Mage", region: "www" as const, userRoute: null, userComp: USER_COMP };

    const first = await recommendReferences(input, deps);
    expect(first.ok).toBe(true);
    expect(first.candidates.length).toBeGreaterThan(0);
    expect(first.candidates[0].keyPercent).toBe(92);
    expect(first.candidates[0].parsePercent).toBe(96);
    expect(first.candidates[0].amount).toBe(310_042);
    expect(first.candidates[0].url).toContain("#fight=7");

    const rankingCalls = queries.filter((q) => q.includes("CharacterRankings")).length;
    expect(rankingCalls).toBeGreaterThanOrEqual(1);
    await recommendReferences(input, deps);
    expect(queries.filter((q) => q.includes("CharacterRankings")).length).toBe(rankingCalls);
  });
});
