import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDungeonZoneCache,
  resolveDungeonEncounter,
  season2EncounterIds,
} from "@/lib/wcl/dungeon-zones";

/**
 * 副本 → encounter id 静态映射验收（真实探测核实，2026-08）。
 *  - 12.1 赛季 8 副本全覆盖，encounter id 与 live 探测一致
 *  - 静态命中零配额（不发请求）
 *  - 归一化容忍 "Kings' Rest" vs "King's Rest" 撇号差异
 */

describe("season2EncounterIds（静态映射）", () => {
  it("12.1 赛季 8 副本全覆盖", () => {
    const ids = season2EncounterIds();
    expect(Object.keys(ids)).toHaveLength(8);
    expect(ids["altaroffangs"]).toBe(12993);
    expect(ids["denofnalorakk"]).toBe(12825);
    expect(ids["kingsrest"]).toBe(61762);
    expect(ids["murderrow"]).toBe(12813);
    expect(ids["rubylifepools"]).toBe(112521);
    expect(ids["templeofsethraliss"]).toBe(61877);
    expect(ids["theblindingvale"]).toBe(12859);
    expect(ids["voidscararena"]).toBe(12923);
  });
});

describe("resolveDungeonEncounter", () => {
  afterEach(() => clearDungeonZoneCache());

  it("静态命中返回 encounter id 且不发请求（零配额）", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const r = await resolveDungeonEncounter("www", "tok", "Altar of Fangs", { fetchFn });
    expect(r?.encounterId).toBe(12993);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("撇号差异归一化：'King's Rest' 与 'Kings' Rest' 均命中", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const a = await resolveDungeonEncounter("www", "tok", "King's Rest", { fetchFn });
    const b = await resolveDungeonEncounter("www", "tok", "Kings' Rest", { fetchFn });
    expect(a?.encounterId).toBe(61762);
    expect(b?.encounterId).toBe(61762);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("静态未命中时走动态解析（expansion(7).zones → live 赛季 zone）", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          data: {
            worldData: {
              expansion: {
                zones: [
                  { name: "Mythic+ Season 2 (PTR)", encounters: [{ id: 99999, name: "New Dungeon" }] },
                  { name: "Mythic+ Season 2", encounters: [{ id: 88888, name: "New Dungeon" }] },
                ],
              },
            },
          },
        }),
        { status: 200 },
      ),
    );
    const r = await resolveDungeonEncounter("www", "tok", "New Dungeon", { fetchFn });
    // 排除 PTR，取 live 赛季的 encounter
    expect(r?.encounterId).toBe(88888);
    expect(fetchFn).toHaveBeenCalled();
  });

  it("未知副本返回 null（降级为无候选）", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ data: { worldData: { expansion: { zones: [] } } } }), { status: 200 }),
    );
    const r = await resolveDungeonEncounter("www", "tok", "Totally Unknown", { fetchFn });
    expect(r).toBeNull();
  });

  it("动态解析结果进程内缓存（第二次不再请求）", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          data: {
            worldData: {
              expansion: {
                zones: [{ name: "Mythic+ Season 2", encounters: [{ id: 88888, name: "New Dungeon" }] }],
              },
            },
          },
        }),
        { status: 200 },
      ),
    );
    const r1 = await resolveDungeonEncounter("www", "tok", "New Dungeon", { fetchFn });
    const r2 = await resolveDungeonEncounter("www", "tok", "New Dungeon", { fetchFn });
    expect(r1?.encounterId).toBe(88888);
    expect(r2?.encounterId).toBe(88888);
    expect(fetchFn).toHaveBeenCalledTimes(1); // 第二次命中缓存
  });
});
