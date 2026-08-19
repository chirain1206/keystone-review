import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ageInDays,
  clearSearchCache,
  dedupeByCode,
  estimateKeyPercent,
  extractSpecPercents,
  filterByLevelRange,
  limitEntries,
  maxAgeDays,
  maxCandidates,
  normalizeSpec,
  parseBestRank,
  parseRankingEntries,
  rangeDown,
  rangeUp,
  rankByRecency,
  rankRecommendations,
  rankingMetric,
  recencyDays,
  recommendReferences,
  samplesPerLevel,
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

describe("parseBestRank / estimateKeyPercent（playerscore best/totalParses 估算）", () => {
  it("parseBestRank 去 ~ 前缀，兼容数字/字符串，非法返回 null", () => {
    expect(parseBestRank("~43")).toBe(43);
    expect(parseBestRank("43")).toBe(43);
    expect(parseBestRank(43)).toBe(43);
    expect(parseBestRank("~ 43")).toBe(43);
    expect(parseBestRank("abc")).toBeNull();
    expect(parseBestRank(null)).toBeNull();
    expect(parseBestRank(-1)).toBeNull();
  });

  it("estimateKeyPercent 按 round(100*(1-best/total)) 计算", () => {
    expect(estimateKeyPercent("~43", 1093)).toBe(96);
    expect(estimateKeyPercent("~4", 75)).toBe(95);
  });

  it("边界：下限 0、上限 99", () => {
    expect(estimateKeyPercent("~795", 795)).toBe(0);
    expect(estimateKeyPercent("~1", 1000)).toBe(99);
    expect(estimateKeyPercent("~1000", 100)).toBe(0);
  });

  it("totalParses 缺失/非法或 best 缺失 → null", () => {
    expect(estimateKeyPercent("~43", null)).toBeNull();
    expect(estimateKeyPercent("~43", 0)).toBeNull();
    expect(estimateKeyPercent(null, 1093)).toBeNull();
  });
});

describe("extractSpecPercents（Key% 回退链：dps bracketPercent → playerscore bracketPercent → playerscore best/totalParses → null）", () => {
  const char = (over: Record<string, unknown> = {}) => ({ spec: "Windwalker", ...over });
  const wrap = (c: Record<string, unknown>) => ({ data: [{ roles: { dps: { characters: [c] } } }] });

  it("dps 口径 bracketPercent 为主（ZH8q4LjDNKAfYRXC 例：网页 100 == dps bracketPercent=100）", () => {
    const dps = wrap(char({ bracketPercent: 100 }));
    const score = wrap(char({ bracketPercent: 50, best: "~1", totalParses: 1000 }));
    expect(extractSpecPercents(dps, score, "Windwalker")).toEqual({ keyPercent: 100, parsePercent: null });
  });

  it("dps bracketPercent=0 → playerscore bracketPercent 兜底", () => {
    const dps = wrap(char({ bracketPercent: 0 }));
    const score = wrap(char({ bracketPercent: 92 }));
    expect(extractSpecPercents(dps, score, "Windwalker")).toEqual({ keyPercent: 92, parsePercent: null });
  });

  it("dps=0 且 playerscore bracketPercent=0 → playerscore best/totalParses 公式兜底", () => {
    const dps = wrap(char({ bracketPercent: 0 }));
    const score = wrap(char({ bracketPercent: 0, best: "~105", totalParses: 958 }));
    expect(extractSpecPercents(dps, score, "Windwalker")).toEqual({ keyPercent: 89, parsePercent: null }); // 100*(1-105/958)≈89
  });

  it("全无 → null（交 DPS 兜底）", () => {
    const dps = wrap(char({ bracketPercent: 0 }));
    const score = wrap(char({ bracketPercent: 0 }));
    expect(extractSpecPercents(dps, score, "Windwalker")).toEqual({ keyPercent: null, parsePercent: null });
  });

  it("结构缺失/专精未知 → null", () => {
    expect(extractSpecPercents(null, null, "Windwalker")).toEqual({ keyPercent: null, parsePercent: null });
    expect(extractSpecPercents(wrap(char({ bracketPercent: 88 })), null, "Unknown")).toEqual({ keyPercent: null, parsePercent: null });
  });

  it("healers 角色也能提取", () => {
    const dps = { data: [{ roles: { healers: { characters: [{ spec: "Restoration", bracketPercent: 83 }] } } }] };
    expect(extractSpecPercents(dps, null, "Restoration")).toEqual({ keyPercent: 83, parsePercent: null });
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
    expect(limitEntries(entries, maxCandidates())).toHaveLength(maxCandidates());
  });

  it("sortByAmountDesc：DPS 降序，null 排最后", () => {
    const entries = [entry("a"), entry("b", { amount: 11_000 }), entry("c", { amount: 12_345 }), entry("d", { amount: 9_800 })];
    expect(sortByAmountDesc(entries).map((x) => x.code)).toEqual(["c", "b", "d", "a"]);
  });
});

describe("rankRecommendations（层数从高到低 + 层内 Key % 优先）", () => {
  const item = (
    id: string,
    level: number | null,
    keyPercent: number | null,
    amount: number | null,
    route: number | null,
    comp: number | null,
  ) => ({ id, level, keyPercent, amount, routeSimilarity: route, compSimilarity: comp });

  it("主排序层数降序，层内 Key % 降序 → DPS → 路线 → 阵容", () => {
    const items = [
      item("a", 10, 95, 9_000, 0.1, 0.1),
      item("b", 11, 88, 11_000, 0.8, 0.9), // 高层排最前
      item("c", 11, 92, 9_000, 0.5, 0.5),
      item("d", 11, 92, 13_000, 0.5, 0.5),
      item("e", 10, 96, 9_000, 0.1, 0.1),
    ];
    expect(rankRecommendations(items).map((x) => x.id)).toEqual(["d", "c", "b", "e", "a"]);
  });

  it("无 Key % 排最后，仅按 DPS/相似度排序", () => {
    const items = [
      item("a", 10, null, 9_000, 0.9, 0.5),
      item("b", 10, 92, 5_000, 0.1, 0.1),
      item("c", 10, null, 13_000, 0.9, 0.8),
    ];
    expect(rankRecommendations(items).map((x) => x.id)).toEqual(["b", "c", "a"]);
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

describe("环境变量配置（RANGE_DOWN/RANGE_UP/SAMPLES_PER_LEVEL/MAX_CANDIDATES/RANKING_METRIC）", () => {
  const prev = {
    down: process.env.RANGE_DOWN,
    up: process.env.RANGE_UP,
    samples: process.env.SAMPLES_PER_LEVEL,
    max: process.env.MAX_CANDIDATES,
    metric: process.env.RANKING_METRIC,
  };
  afterEach(() => {
    for (const [k, v] of Object.entries({
      RANGE_DOWN: prev.down,
      RANGE_UP: prev.up,
      SAMPLES_PER_LEVEL: prev.samples,
      MAX_CANDIDATES: prev.max,
      RANKING_METRIC: prev.metric,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("rangeDown 缺省 1；rangeUp 缺省 2；samplesPerLevel 缺省 3；maxCandidates 缺省 12", () => {
    delete process.env.RANGE_DOWN;
    delete process.env.RANGE_UP;
    delete process.env.SAMPLES_PER_LEVEL;
    delete process.env.MAX_CANDIDATES;
    expect(rangeDown()).toBe(1);
    expect(rangeUp()).toBe(2);
    expect(samplesPerLevel()).toBe(3);
    expect(maxCandidates()).toBe(12);
  });

  it("非法值回退默认", () => {
    process.env.RANGE_DOWN = "abc";
    process.env.RANGE_UP = "-2";
    expect(rangeDown()).toBe(1);
    expect(rangeUp()).toBe(2);
  });

  it("rankingMetric 缺省 dps", () => {
    delete process.env.RANKING_METRIC;
    expect(rankingMetric()).toBe("dps");
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
    expect(ageInDays(now + DAY, now)).toBeNull();
  });

  it("新候选保持原顺序；较早候选排后并标注 stale；超龄过滤", () => {
    const ranked = [
      item("fresh2", now - 2 * DAY),
      item("stale1", now - 20 * DAY),
      item("fresh1", now - 1 * DAY),
      item("tooOld", now - 40 * DAY),
      item("unknown", null),
    ];
    const out = rankByRecency(ranked, { nowMs: now, recencyDays: 14, maxAgeDays: 30 });
    expect(out.map((r) => r.item.id)).toEqual(["fresh2", "fresh1", "unknown", "stale1"]);
    expect(out.map((r) => r.recency)).toEqual(["fresh", "fresh", "fresh", "stale"]);
    expect(out.find((r) => r.item.id === "tooOld")).toBeUndefined();
  });

  it("recencyDays 缺省 14；maxAgeDays 缺省 30", () => {
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

describe("recommendReferences（mock 分支：Key % 优先排序）", () => {
  it("主排序按 Key % 降序 + 链接带 #fight", async () => {
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
                  rankingsDps: {
                    data: [{ roles: { dps: { characters: [{ spec: "Fire", bracketPercent: 92, rankPercent: 96 }] } } }],
                  },
                  rankingsPlayerscore: {
                    data: [{ roles: { dps: { characters: [{ spec: "Fire", bracketPercent: 88, best: "~105", totalParses: 958 }] } } }],
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

  it("第二次调用不再请求 characterRankings，且 Key% 取 dps 口径 bracketPercent", async () => {
    const { fetchFn, queries } = makeFakeFetch();
    const deps = { fetchFn, clientId: "id", clientSecret: "secret" };
    const input = { dungeon: "Ruby Life Pools", level: 15, spec: "Fire", playerClass: "Mage", region: "www" as const, userRoute: null, userComp: USER_COMP };

    const first = await recommendReferences(input, deps);
    expect(first.ok).toBe(true);
    expect(first.candidates.length).toBeGreaterThan(0);
    expect(first.candidates[0].keyPercent).toBe(92); // dps bracketPercent 为主
    expect(first.candidates[0].amount).toBe(310_042);
    expect(first.candidates[0].url).toContain("#fight=7");

    const rankingCalls = queries.filter((q) => q.includes("CharacterRankings")).length;
    expect(rankingCalls).toBeGreaterThanOrEqual(1);
    await recommendReferences(input, deps);
    expect(queries.filter((q) => q.includes("CharacterRankings")).length).toBe(rankingCalls);
  });
});
