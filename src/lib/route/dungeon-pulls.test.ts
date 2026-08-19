import { describe, expect, it } from "vitest";
import {
  dungeonPullsToFingerprint,
  type DungeonPull,
} from "@/lib/route/dungeon-pulls";

/**
 * WCL dungeonPulls → 路线指纹 验收：
 *  - trash/boss 波划分（encounterID === 0 → trash）
 *  - 相对时间归一化 + bossAnchor
 *  - 无数据 / 全部无名 NPC → 降级为 null
 */

function pull(
  id: number,
  encounterID: number,
  startTime: number,
  endTime: number,
  npcs: { gameId: number | null; name: string | null }[],
): DungeonPull {
  return { id, name: `P${id}`, encounterID, startTime, endTime, npcs };
}

describe("dungeonPullsToFingerprint", () => {
  const dungeon = "Ruby Life Pools";
  const opts = { runStartMs: 0, durationMs: 500_000 };

  it("按 encounterID 划分 trash/boss 波并计数 NPC", () => {
    const pulls: DungeonPull[] = [
      pull(1, 0, 0, 30_000, [
        { gameId: 111, name: "Mistcaller" },
        { gameId: 222, name: "Spinemaw Staghorn" },
        { gameId: 222, name: "Spinemaw Staghorn" },
      ]),
      pull(2, 901, 120_000, 200_000, [{ gameId: 333, name: "Ingra Maloch" }]),
    ];
    const fp = dungeonPullsToFingerprint(dungeon, pulls, opts);
    expect(fp).not.toBeNull();
    expect(fp!.bossCount).toBe(1);
    expect(fp!.trashWaves).toHaveLength(1);
    expect(fp!.waves).toHaveLength(2);
    // trash 波：Spinemaw Staghorn 计数合并为 2
    const trash = fp!.trashWaves[0];
    const stag = trash.npcs.find((n) => n.name === "Spinemaw Staghorn");
    expect(stag?.count).toBe(2);
    // boss 波
    expect(fp!.waves[1].kind).toBe("boss");
  });

  it("相对时间归一化到 [0,1]，bossAnchor 记录之前 boss 波数", () => {
    const pulls: DungeonPull[] = [
      pull(1, 0, 0, 30_000, [{ gameId: 111, name: "A" }]),
      pull(2, 901, 100_000, 150_000, [{ gameId: 333, name: "Boss" }]),
      pull(3, 0, 250_000, 300_000, [{ gameId: 444, name: "B" }]),
    ];
    const fp = dungeonPullsToFingerprint(dungeon, pulls, opts);
    expect(fp).not.toBeNull();
    // 第三波（trash）出现在 boss 之后 → bossAnchor = 1
    const third = fp!.waves[2];
    expect(third.kind).toBe("trash");
    expect(third.bossAnchor).toBe(1);
    expect(third.relTime).toBeCloseTo(0.5, 5);
  });

  it("空 pulls 返回 null（无路线数据 → 降级）", () => {
    expect(dungeonPullsToFingerprint(dungeon, [], opts)).toBeNull();
  });

  it("全部 NPC 无名返回 null（无可签名怪物）", () => {
    const pulls: DungeonPull[] = [
      pull(1, 0, 0, 30_000, [{ gameId: 111, name: null }]),
    ];
    expect(dungeonPullsToFingerprint(dungeon, pulls, opts)).toBeNull();
  });

  it("跳过无名 NPC，仅保留有名 NPC 参与签名", () => {
    const pulls: DungeonPull[] = [
      pull(1, 0, 0, 30_000, [
        { gameId: 111, name: null },
        { gameId: 222, name: "Mistcaller" },
      ]),
    ];
    const fp = dungeonPullsToFingerprint(dungeon, pulls, opts);
    expect(fp).not.toBeNull();
    expect(fp!.trashWaves[0].npcs.map((n) => n.name)).toEqual(["Mistcaller"]);
  });
});
