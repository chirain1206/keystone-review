import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSearchCache,
  dedupeByCode,
  filterByLevelRange,
  limitEntries,
  normalizeSpec,
  parseRankingEntries,
  RANKING_CANDIDATE_LIMIT,
  rangeLevels,
  rankRecommendations,
  rankingMetric,
  recommendReferences,
  sortByAmountDesc,
  specMatchesTeam,
  wclSlug,
} from "@/lib/wcl/rankings";
import { clearDungeonZoneCache } from "@/lib/wcl/dungeon-zones";
import { clearNpcNameCache } from "@/lib/wcl/npc-names";
import { buildCompProfile } from "@/lib/route/comp-profile";

/**
 * 自动对比推荐验收：
 *  - characterRankings 真实返回结构（{ rankings: [...] } 包裹）防御性解析
 *  - 层数范围过滤 / 去重 / N 上限 / DPS 降序
 *  - "表现优先，相似度其次"排序（rankRecommendations）
 *  - 专精/职业过滤（className+specName、候选队伍含该专精）
 *  - mock 分支表现排序
 *  - 候选搜索缓存命中不重复请求
 */

const USER_COMP = buildCompProfile([
  { class: "Warrior", spec: "Protection" },
  { class: "Shaman", spec: "Restoration" },
  { class: "Mage", spec: "Fire" },
  { class: "Rogue", spec: "Assassination" },
  { class: "Druid", spec: "Balance" },
]);

describe("parseRankingEntries（真实结构：{ rankings: [...] } 包裹）", () => {
  it("解析包裹结构的 report.code / fightID / hardModeLevel / amount / score / medal", () => {
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
        {
          name: "X",
          class: "Mage",
          spec: "Fire",
          amount: 200_000,
          bracketData: 11,
          duration: 900_000,
          medal: "none",
          report: { code: "BBB" },
        },
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].code).toBe("Cw8GavzArQ9nKBDZ");
    expect(entries[0].fightId).toBe(67);
    expect(entries[0].level).toBe(10);
    expect(entries[0].amount).toBeCloseTo(310042.28, 2);
    expect(entries[0].score).toBe(335);
    expect(entries[0].medal).toBe("gold");
    expect(entries[0].durationSec).toBe(1077);
    expect(entries[1].level).toBe(11); // bracketData 兜底
  });

  it("{ error } 返回空（如 specName 单独传时报 Invalid class and spec）", () => {
    expect(parseRankingEntries({ error: "Invalid class and spec specified." })).toEqual([]);
  });

  it("裸数组也兼容；缺 code 的条目跳过", () => {
    const entries = parseRankingEntries([
      { report: { code: "AAA", fightID: 1 }, hardModeLevel: 10, amount: 100 },
      { noCode: true },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].code).toBe("AAA");
  });

  it("兼容 fightRankings 风格的顶层 reportID/keystoneLevel（降级路径）", () => {
    const entries = parseRankingEntries({
      rankings: [{ reportID: "TOP123", keystoneLevel: 15, duration: 1_500_000, amount: 100 }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].code).toBe("TOP123");
    expect(entries[0].level).toBe(15);
    expect(entries[0].durationSec).toBe(1500);
  });

  it("非对象输入返回空", () => {
    expect(parseRankingEntries(null)).toEqual([]);
    expect(parseRankingEntries("x")).toEqual([]);
  });
});

describe("层数范围 / 去重 / N 上限 / DPS 降序", () => {
  const e = (code: string, level: number | null, amount: number | null) => ({
    code,
    level,
    durationSec: 100,
    success: true,
    amount,
    score: null as number | null,
    medal: null as string | null,
    metricName: null as string | null,
  });

  it("filterByLevelRange 按 [level-range, level+range] 过滤，未知层数保留", () => {
    const entries = [e("a", 14, 1), e("b", 15, 1), e("c", 17, 1), e("d", null, 1)];
    expect(filterByLevelRange(entries, 15, 1).map((x) => x.code)).toEqual(["a", "b", "d"]);
  });

  it("dedupeByCode 去重保留首个", () => {
    const entries = [e("a", 15, 1), e("b", 15, 1), e("a", 16, 1)];
    expect(dedupeByCode(entries).map((x) => x.code)).toEqual(["a", "b"]);
  });

  it("limitEntries 取前 N", () => {
    const entries = Array.from({ length: 20 }, (_, i) => e(`c${i}`, 15, 1));
    expect(limitEntries(entries, RANKING_CANDIDATE_LIMIT)).toHaveLength(RANKING_CANDIDATE_LIMIT);
    expect(RANKING_CANDIDATE_LIMIT).toBeLessThanOrEqual(10);
  });

  it("sortByAmountDesc：DPS 降序，null 排最后", () => {
    const entries = [e("a", 15, null), e("b", 15, 11_000), e("c", 15, 12_345), e("d", 15, 9_800)];
    expect(sortByAmountDesc(entries).map((x) => x.code)).toEqual(["c", "b", "d", "a"]);
  });
});

describe("rankRecommendations（表现优先，相似度其次）", () => {
  it("主排序 DPS 降序，DPS 相同再比路线，最后比阵容", () => {
    const items = [
      { id: "a", amount: 11_000, routeSimilarity: 0.8, compSimilarity: 0.9 },
      { id: "b", amount: 13_000, routeSimilarity: 0.1, compSimilarity: 0.1 },
      { id: "c", amount: 11_000, routeSimilarity: 0.9, compSimilarity: 0.5 },
      { id: "d", amount: 11_000, routeSimilarity: 0.9, compSimilarity: 0.8 },
    ];
    expect(rankRecommendations(items).map((x) => x.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("无 DPS（null）排最后，仅按相似度排序", () => {
    const items = [
      { id: "a", amount: null, routeSimilarity: 0.9, compSimilarity: 0.5 },
      { id: "b", amount: 12_000, routeSimilarity: 0.1, compSimilarity: 0.1 },
      { id: "c", amount: null, routeSimilarity: 0.9, compSimilarity: 0.8 },
    ];
    expect(rankRecommendations(items).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("不改动入参", () => {
    const items = [{ id: "a", amount: 11_000, routeSimilarity: 0.8, compSimilarity: 0.9 }];
    rankRecommendations(items);
    expect(items[0].id).toBe("a");
  });
});

describe("专精/职业过滤", () => {
  it("normalizeSpec 忽略大小写/空格/连字符", () => {
    expect(normalizeSpec("Beast Mastery")).toBe("beastmastery");
    expect(normalizeSpec("Fire")).toBe("fire");
  });

  it("wclSlug 去空格/连字符（className/specName 用）", () => {
    expect(wclSlug("Death Knight")).toBe("DeathKnight");
    expect(wclSlug("Demon Hunter")).toBe("DemonHunter");
    expect(wclSlug("Beast Mastery")).toBe("BeastMastery");
    expect(wclSlug("Windwalker")).toBe("Windwalker");
  });

  it("specMatchesTeam：候选阵容含该专精才保留；空/Unknown 不过滤", () => {
    expect(specMatchesTeam(["Protection", "Restoration", "Fire"], "Fire")).toBe(true);
    expect(specMatchesTeam(["Protection", "Restoration", "Fire"], "Beast Mastery")).toBe(false);
    expect(specMatchesTeam(["Fire"], "")).toBe(true);
    expect(specMatchesTeam(["Fire"], "Unknown")).toBe(true);
  });
});

describe("环境变量配置（RANGE_LEVELS / RANKING_METRIC）", () => {
  const prev = { range: process.env.RANGE_LEVELS, metric: process.env.RANKING_METRIC };
  afterEach(() => {
    for (const [k, v] of Object.entries({ RANGE_LEVELS: prev.range, RANKING_METRIC: prev.metric })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("rangeLevels 缺省 1，非法回退 1", () => {
    delete process.env.RANGE_LEVELS;
    expect(rangeLevels()).toBe(1);
    process.env.RANGE_LEVELS = "abc";
    expect(rangeLevels()).toBe(1);
  });

  it("rankingMetric 缺省 dps，非法回退 dps", () => {
    delete process.env.RANKING_METRIC;
    expect(rankingMetric()).toBe("dps");
    process.env.RANKING_METRIC = "hps";
    expect(rankingMetric()).toBe("hps");
  });
});

describe("recommendReferences（mock 分支：表现优先排序）", () => {
  it("主排序按 DPS 降序（表现优先，即便该候选相似度更低）", async () => {
    const r = await recommendReferences(
      {
        dungeon: "Ruby Life Pools",
        level: 15,
        spec: "Fire",
        playerClass: "Mage",
        region: "www",
        userRoute: null,
        userComp: USER_COMP,
        isMock: true,
      },
      {},
    );
    expect(r.ok).toBe(true);
    expect(r.candidates.length).toBeGreaterThan(0);
    // mock 里 MOCK3 DPS 最高（12345）但阵容相似度最低 → 应排第一（表现优先）
    expect(r.candidates[0].code).toBe("MOCK3");
    expect(r.candidates[0].amount).toBe(12_345);
    // DPS 降序
    const amount = r.candidates.map((c) => c.amount ?? -1);
    expect([...amount].sort((a, b) => b - a)).toEqual(amount);
    // 无用户路线 → 路线相似度为 null（降级）
    expect(r.candidates.every((c) => c.routeSimilarity === null)).toBe(true);
    // score/medal/metricName 已回填（展示"该专精表现"用）
    expect(r.candidates[0].score).not.toBeNull();
    expect(r.candidates[0].medal).toBe("gold");
    expect(r.candidates[0].metricName).toBe("dps");
    expect(r.candidates[0].url).toContain("warcraftlogs.com/reports/");
  });

  it("无 WCL 密钥（未配置）自动走 mock，不抛错", async () => {
    const r = await recommendReferences(
      { dungeon: "X", level: 10, spec: "Fire", region: "www", isMock: true },
      {},
    );
    expect(r.ok).toBe(true);
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
                    hasMorePages: false,
                    count: 1,
                    rankings: [
                      {
                        name: "Faoln",
                        class: "Mage",
                        spec: "Fire",
                        amount: 310_042,
                        hardModeLevel: 15,
                        duration: 1_500_000,
                        score: 335,
                        medal: "gold",
                        report: { code: "ABC123", fightID: 7 },
                      },
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
                      keystoneTime: 1_500_000,
                      kill: true,
                      startTime: 0,
                      endTime: 1_500_000,
                      friendlyPlayers: [1, 2, 3, 4, 5],
                      friendlySpecs: ["Protection", "Restoration", "Fire", "Assassination", "Balance"],
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
                  dungeonPulls: [
                    {
                      id: 1,
                      name: "P1",
                      encounterID: 0,
                      kill: true,
                      startTime: 0,
                      endTime: 30_000,
                      enemyNPCs: [{ id: 11, gameID: 111 }],
                    },
                  ],
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (query.includes("NpcNames")) {
        return new Response(
          JSON.stringify({ data: { gameData: { n0: { id: 111, name: "Mistcaller" } } } }),
          { status: 200 },
        );
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

  it("同一 (dungeon+level+spec) 第二次调用不再请求 characterRankings，且解析出 DPS", async () => {
    const { fetchFn, queries } = makeFakeFetch();
    const deps = { fetchFn, clientId: "id", clientSecret: "secret" };
    const input = {
      dungeon: "Ruby Life Pools",
      level: 15,
      spec: "Fire",
      playerClass: "Mage",
      region: "www" as const,
      userRoute: null,
      userComp: USER_COMP,
    };

    const first = await recommendReferences(input, deps);
    expect(first.ok).toBe(true);
    expect(first.candidates.length).toBeGreaterThan(0);
    expect(first.candidates[0].amount).toBe(310_042);
    expect(first.candidates[0].score).toBe(335);
    expect(first.candidates[0].medal).toBe("gold");

    const rankingCallsAfterFirst = queries.filter((q) => q.includes("CharacterRankings")).length;
    expect(rankingCallsAfterFirst).toBeGreaterThanOrEqual(1);

    // 第二次：命中搜索缓存 → 不再请求 characterRankings
    await recommendReferences(input, deps);
    expect(queries.filter((q) => q.includes("CharacterRankings")).length).toBe(rankingCallsAfterFirst);
  });
});
