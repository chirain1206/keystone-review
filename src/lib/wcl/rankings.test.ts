import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSearchCache,
  dedupeByCode,
  filterByLevelRange,
  filterByMinParse,
  limitEntries,
  minParsePercent,
  normalizeSpec,
  parseRankingEntries,
  RANKING_CANDIDATE_LIMIT,
  rangeLevels,
  rankRecommendations,
  rankingMetric,
  recommendReferences,
  sortByParseDesc,
  sortSuccessFirst,
  specMatchesTeam,
} from "@/lib/wcl/rankings";
import { clearDungeonZoneCache } from "@/lib/wcl/dungeon-zones";
import { clearNpcNameCache } from "@/lib/wcl/npc-names";
import { buildCompProfile } from "@/lib/route/comp-profile";

/**
 * 自动对比推荐验收：
 *  - 排行 JSON 防御性解析（含 parse 分位 / 指标值）/ 层数范围过滤 / 去重 / N 上限
 *  - parse 过滤阈值 + parse 降序
 *  - 专精过滤（候选队伍含该专精）
 *  - "表现优先，相似度其次"排序（rankRecommendations）
 *  - mock 分支相似度/表现排序
 *  - 候选搜索缓存命中不重复请求（zone/rankings 只拉一次）
 */

const USER_COMP = buildCompProfile([
  { class: "Warrior", spec: "Protection" },
  { class: "Shaman", spec: "Restoration" },
  { class: "Mage", spec: "Fire" },
  { class: "Rogue", spec: "Assassination" },
  { class: "Druid", spec: "Balance" },
]);

describe("parseRankingEntries（防御性解析）", () => {
  it("兼容 reportID / report.code 多种字段名", () => {
    const raw = [
      { reportID: "AAA111", fightID: 7, keystoneLevel: 15, duration: 1_500_000, kill: true },
      { report: { code: "BBB222" }, level: 14, duration: 1_600_000 },
      { reportId: "CCC333", keystone_level: 16 },
    ];
    const entries = parseRankingEntries(raw);
    expect(entries.map((e) => e.code)).toEqual(["AAA111", "BBB222", "CCC333"]);
    expect(entries[0].fightId).toBe(7);
    expect(entries[0].level).toBe(15);
    expect(entries[0].durationSec).toBe(1500);
    expect(entries[0].success).toBe(true);
    expect(entries[2].level).toBe(16);
  });

  it("提取 parse 分位（historicalPercent 0–100 与 0–1 均归一化）与指标值", () => {
    const entries = parseRankingEntries([
      { reportID: "A", historicalPercent: 92.4, amount: 12_345 },
      { reportID: "B", rankPercent: 0.87, total: 11_000 },
    ]);
    expect(entries[0].parsePercent).toBeCloseTo(92.4, 5);
    expect(entries[0].amount).toBe(12_345);
    expect(entries[1].parsePercent).toBeCloseTo(87, 5);
    expect(entries[1].amount).toBe(11_000);
  });

  it("缺 parse/指标值时为 null（降级不阻塞）", () => {
    const entries = parseRankingEntries([{ reportID: "X", keystoneLevel: 15 }]);
    expect(entries[0].parsePercent).toBeNull();
    expect(entries[0].amount).toBeNull();
  });

  it("缺 code 的条目被跳过；时长 ms→秒", () => {
    const entries = parseRankingEntries([
      { noCode: true, keystoneLevel: 15 },
      { reportID: "X", duration: 90_000 },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].code).toBe("X");
    expect(entries[0].durationSec).toBe(90);
  });

  it("非数组 / 非对象输入返回空", () => {
    expect(parseRankingEntries(null)).toEqual([]);
    expect(parseRankingEntries({ a: 1 })).toEqual([]);
  });
});

describe("层数范围 / 去重 / N 上限 / 成功优先", () => {
  const e = (code: string, level: number | null, success: boolean) => ({
    code,
    level,
    durationSec: 100,
    success,
    parsePercent: null as number | null,
    amount: null as number | null,
    metricName: null as string | null,
  });

  it("filterByLevelRange 按 [level-range, level+range] 过滤，未知层数保留", () => {
    const entries = [e("a", 14, true), e("b", 15, true), e("c", 17, true), e("d", null, true)];
    expect(filterByLevelRange(entries, 15, 1).map((x) => x.code)).toEqual(["a", "b", "d"]);
  });

  it("dedupeByCode 去重保留首个", () => {
    const entries = [e("a", 15, true), e("b", 15, true), e("a", 16, true)];
    expect(dedupeByCode(entries).map((x) => x.code)).toEqual(["a", "b"]);
  });

  it("limitEntries 取前 N", () => {
    const entries = Array.from({ length: 20 }, (_, i) => e(`c${i}`, 15, true));
    expect(limitEntries(entries, RANKING_CANDIDATE_LIMIT)).toHaveLength(RANKING_CANDIDATE_LIMIT);
    expect(RANKING_CANDIDATE_LIMIT).toBeLessThanOrEqual(10);
  });

  it("sortSuccessFirst 限时成功优先且稳定", () => {
    const entries = [e("a", 15, false), e("b", 15, true), e("c", 15, false)];
    expect(sortSuccessFirst(entries).map((x) => x.code)).toEqual(["b", "a", "c"]);
  });
});

describe("parse 过滤与排序", () => {
  const e = (code: string, parse: number | null) => ({
    code,
    level: 15,
    durationSec: 100,
    success: true,
    parsePercent: parse,
    amount: null as number | null,
    metricName: null as string | null,
  });

  it("sortByParseDesc：parse 降序，null 排最后", () => {
    const entries = [e("a", null), e("b", 92), e("c", 96), e("d", 88)];
    expect(sortByParseDesc(entries).map((x) => x.code)).toEqual(["c", "b", "d", "a"]);
  });

  it("filterByMinParse：过滤 < threshold，保留 null 与达标", () => {
    const entries = [e("a", 79), e("b", 80), e("c", 95), e("d", null)];
    expect(filterByMinParse(entries, 80).map((x) => x.code)).toEqual(["b", "c", "d"]);
  });

  it("filterByMinParse：threshold<=0 不过滤", () => {
    const entries = [e("a", 10), e("b", 95)];
    expect(filterByMinParse(entries, 0).map((x) => x.code)).toEqual(["a", "b"]);
  });
});

describe("rankRecommendations（表现优先，相似度其次）", () => {
  it("主排序 parse 降序，parse 相同再比路线，最后比阵容", () => {
    const items = [
      { id: "a", parsePercent: 90, routeSimilarity: 0.8, compSimilarity: 0.9 },
      { id: "b", parsePercent: 95, routeSimilarity: 0.1, compSimilarity: 0.1 },
      { id: "c", parsePercent: 90, routeSimilarity: 0.9, compSimilarity: 0.5 },
      { id: "d", parsePercent: 90, routeSimilarity: 0.9, compSimilarity: 0.8 },
    ];
    expect(rankRecommendations(items).map((x) => x.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("无 parse（null）排最后，仅按相似度排序", () => {
    const items = [
      { id: "a", parsePercent: null, routeSimilarity: 0.9, compSimilarity: 0.5 },
      { id: "b", parsePercent: 92, routeSimilarity: 0.1, compSimilarity: 0.1 },
      { id: "c", parsePercent: null, routeSimilarity: 0.9, compSimilarity: 0.8 },
    ];
    expect(rankRecommendations(items).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("不改动入参", () => {
    const items = [{ id: "a", parsePercent: 90, routeSimilarity: 0.8, compSimilarity: 0.9 }];
    rankRecommendations(items);
    expect(items[0].id).toBe("a");
  });
});

describe("专精过滤", () => {
  it("normalizeSpec 忽略大小写/空格/连字符", () => {
    expect(normalizeSpec("Beast Mastery")).toBe("beastmastery");
    expect(normalizeSpec("Fire")).toBe("fire");
  });

  it("specMatchesTeam：候选阵容含该专精才保留", () => {
    expect(specMatchesTeam(["Protection", "Restoration", "Fire", "Assassination", "Balance"], "Fire")).toBe(true);
    expect(specMatchesTeam(["Protection", "Restoration", "Fire"], "Beast Mastery")).toBe(false);
  });

  it("specMatchesTeam：空 / Unknown 不过滤", () => {
    expect(specMatchesTeam(["Fire"], "")).toBe(true);
    expect(specMatchesTeam(["Fire"], "Unknown")).toBe(true);
  });
});

describe("环境变量配置（RANGE_LEVELS / RANKING_METRIC / MIN_PARSE_PERCENT）", () => {
  const prev = {
    range: process.env.RANGE_LEVELS,
    metric: process.env.RANKING_METRIC,
    minParse: process.env.MIN_PARSE_PERCENT,
  };
  afterEach(() => {
    for (const [k, v] of Object.entries({ RANGE_LEVELS: prev.range, RANKING_METRIC: prev.metric, MIN_PARSE_PERCENT: prev.minParse })) {
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

  it("minParsePercent 缺省 80，非法回退 80", () => {
    delete process.env.MIN_PARSE_PERCENT;
    expect(minParsePercent()).toBe(80);
    process.env.MIN_PARSE_PERCENT = "abc";
    expect(minParsePercent()).toBe(80);
  });
});

describe("recommendReferences（mock 分支：表现优先排序）", () => {
  it("主排序按 parse 降序（表现优先，即便该候选相似度更低）", async () => {
    const r = await recommendReferences(
      {
        dungeon: "Ruby Life Pools",
        level: 15,
        spec: "Fire",
        region: "www",
        userRoute: null,
        userComp: USER_COMP,
        isMock: true,
      },
      {},
    );
    expect(r.ok).toBe(true);
    expect(r.candidates.length).toBeGreaterThan(0);
    // mock 里 MOCK3 parse 最高（96）但阵容相似度最低 → 应排第一（表现优先）
    expect(r.candidates[0].code).toBe("MOCK3");
    expect(r.candidates[0].parsePercent).toBe(96);
    // parse 降序
    const parse = r.candidates.map((c) => c.parsePercent ?? -1);
    expect([...parse].sort((a, b) => b - a)).toEqual(parse);
    // 无用户路线 → 路线相似度为 null（降级）
    expect(r.candidates.every((c) => c.routeSimilarity === null)).toBe(true);
    // 指标值/指标名已回填（展示"该专精表现"用）
    expect(r.candidates[0].amount).not.toBeNull();
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
      if (query.includes("WorldZones")) {
        return new Response(
          JSON.stringify({
            data: {
              worldData: {
                zones: [
                  {
                    id: 100,
                    name: "Ruby Life Pools",
                    encounters: [{ id: 200, name: "Ruby Life Pools" }],
                  },
                ],
              },
            },
          }),
          { status: 200 },
        );
      }
      if (query.includes("CharacterRankings")) {
        return new Response(
          JSON.stringify({
            data: {
              worldData: {
                encounter: {
                  characterRankings: [
                    {
                      reportID: "ABC123",
                      fightID: 1,
                      keystoneLevel: 15,
                      duration: 1_500_000,
                      kill: true,
                      historicalPercent: 92,
                      amount: 12_345,
                    },
                  ],
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
                      id: 1,
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

  it("同一 (dungeon+level+spec) 第二次调用不再请求 zone/rankings，且解析出 parse", async () => {
    const { fetchFn, queries } = makeFakeFetch();
    const deps = { fetchFn, clientId: "id", clientSecret: "secret" };
    const input = {
      dungeon: "Ruby Life Pools",
      level: 15,
      spec: "Fire",
      region: "www" as const,
      userRoute: null,
      userComp: USER_COMP,
    };

    const first = await recommendReferences(input, deps);
    expect(first.ok).toBe(true);
    expect(first.candidates.length).toBeGreaterThan(0);
    expect(first.candidates[0].parsePercent).toBe(92);
    expect(first.candidates[0].amount).toBe(12_345);

    const zoneCallsAfterFirst = queries.filter((q) => q.includes("WorldZones")).length;
    const rankingCallsAfterFirst = queries.filter((q) => q.includes("CharacterRankings")).length;
    expect(zoneCallsAfterFirst).toBe(1);
    expect(rankingCallsAfterFirst).toBeGreaterThanOrEqual(1);

    // 第二次：命中搜索缓存 → 不再请求 zone / rankings
    await recommendReferences(input, deps);
    expect(queries.filter((q) => q.includes("WorldZones")).length).toBe(zoneCallsAfterFirst);
    expect(queries.filter((q) => q.includes("CharacterRankings")).length).toBe(rankingCallsAfterFirst);
  });
});
