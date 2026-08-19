import { describe, expect, it } from "vitest";
import {
  buildPlayers,
  filterPlayersByFight,
  mockPlayers,
  preselectPlayerId,
  specToRole,
  type WclActor,
  type WclFightPlayers,
  type WclPlayer,
} from "@/lib/wcl/players";

describe("specToRole（专精 → 定位）", () => {
  it("坦克/治疗/输出/未知", () => {
    expect(specToRole("Protection")).toBe("tank");
    expect(specToRole("Blood")).toBe("tank");
    expect(specToRole("Restoration")).toBe("healer");
    expect(specToRole("Discipline")).toBe("healer");
    expect(specToRole("Fire")).toBe("dps");
    expect(specToRole("Assassination")).toBe("dps");
    expect(specToRole("Unknown")).toBe("unknown");
    expect(specToRole("")).toBe("unknown");
  });
});

describe("buildPlayers（角色列表返回）", () => {
  const actors: WclActor[] = [
    { id: 1, name: "Tanky", subType: "Warrior", type: "Player" },
    { id: 2, name: "Healy", subType: "Shaman", type: "Player" },
    { id: 3, name: "Magey", subType: "Mage", type: "Player" },
    { id: 99, name: "Mistcaller", subType: "Boss", type: "NPC" }, // 应被过滤
  ];
  const fights: WclFightPlayers[] = [
    { id: 7, friendlyPlayers: [1, 2, 3], friendlySpecs: ["Protection", "Restoration", "Fire"] },
  ];

  it("过滤 NPC、合并职业与专精、标记上传者", () => {
    const { players, uploaderName } = buildPlayers(actors, fights, "Magey");
    expect(players.map((p) => p.name)).toEqual(["Tanky", "Healy", "Magey"]);
    const mage = players.find((p) => p.name === "Magey")!;
    expect(mage.class).toBe("Mage");
    expect(mage.spec).toBe("Fire");
    expect(mage.role).toBe("dps");
    expect(mage.isUploader).toBe(true);
    expect(uploaderName).toBe("Magey");
  });

  it("上传者名大小写不敏感匹配", () => {
    const { players } = buildPlayers(actors, fights, "MAGEY");
    expect(players.find((p) => p.name === "Magey")!.isUploader).toBe(true);
  });

  it("无战斗专精时 spec=Unknown、role=unknown", () => {
    const { players } = buildPlayers(actors, [], undefined);
    const tank = players.find((p) => p.name === "Tanky")!;
    expect(tank.spec).toBe("Unknown");
    expect(tank.role).toBe("unknown");
    expect(tank.class).toBe("Warrior");
  });

  it("上传者不在玩家列表时不误标", () => {
    const { players, uploaderName } = buildPlayers(actors, fights, "Nobody");
    expect(players.some((p) => p.isUploader)).toBe(false);
    expect(uploaderName).toBeUndefined();
  });
});

describe("filterPlayersByFight（复盘对象按所选场次过滤）", () => {
  // 一份报告多场大秘境、每场参与玩家不同（FR 本地验收：多场报告返回各自玩家）
  const reportPlayers: WclPlayer[] = [
    { id: 1, name: "Tanky", class: "Warrior", spec: "Protection", role: "tank" },
    { id: 2, name: "Healy", class: "Shaman", spec: "Restoration", role: "healer" },
    { id: 3, name: "Magey", class: "Mage", spec: "Fire", role: "dps", isUploader: true },
    { id: 4, name: "Roguey", class: "Rogue", spec: "Assassination", role: "dps" },
    { id: 5, name: "Druidy", class: "Druid", spec: "Balance", role: "dps" },
  ];

  it("多场报告：各场次只返回该场实际参与的玩家", () => {
    const fightA = filterPlayersByFight(reportPlayers, [1, 2, 3]);
    const fightB = filterPlayersByFight(reportPlayers, [3, 4, 5]);
    expect(fightA.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(fightB.map((p) => p.id)).toEqual([3, 4, 5]);
    expect(fightA.map((p) => p.name)).toEqual(["Tanky", "Healy", "Magey"]);
    expect(fightB.map((p) => p.name)).toEqual(["Magey", "Roguey", "Druidy"]);
  });

  it("无 fight 级玩家信息（缺失/空数组）时回退整份报告玩家列表", () => {
    expect(filterPlayersByFight(reportPlayers, undefined)).toEqual(reportPlayers);
    expect(filterPlayersByFight(reportPlayers, null)).toEqual(reportPlayers);
    expect(filterPlayersByFight(reportPlayers, [])).toEqual(reportPlayers);
  });

  it("过滤结果为空时兜底回退整份报告玩家列表（防空列表）", () => {
    // friendlyPlayers 含未知 id（异常数据）时不应返回空列表阻塞流程
    expect(filterPlayersByFight(reportPlayers, [999, 998])).toEqual(reportPlayers);
  });
});

describe("preselectPlayerId（预选）", () => {
  it("优先上传者", () => {
    expect(preselectPlayerId(mockPlayers())).toBe(3); // DemoMage 标记为上传者
  });

  it("无上传者回退第一个玩家", () => {
    const players: WclPlayer[] = [
      { id: 7, name: "A", class: "Mage", spec: "Fire", role: "dps" },
      { id: 8, name: "B", class: "Rogue", spec: "Assassination", role: "dps" },
    ];
    expect(preselectPlayerId(players)).toBe(7);
  });

  it("空列表返回 undefined", () => {
    expect(preselectPlayerId([])).toBeUndefined();
  });

  it("有 uploaderName 但无 isUploader 标记时按名字匹配", () => {
    const players: WclPlayer[] = [
      { id: 7, name: "A", class: "Mage", spec: "Fire", role: "dps" },
      { id: 8, name: "B", class: "Rogue", spec: "Assassination", role: "dps" },
    ];
    expect(preselectPlayerId(players, "b")).toBe(8);
  });
});
