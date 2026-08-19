import { describe, expect, it } from "vitest";
import { dungeonDisplayName, translateDungeonName } from "@/lib/wcl/dungeon-names";

/**
 * 副本名中英映射（本地验收缺陷修复）：
 *  - 至暗之夜 12.0 第 1 赛季与 12.1 第 2 赛季各 8 本均收录
 *  - 展示形式 = 国服译名 + 英文原名括号
 *  - 未收录副本原样返回英文（不改变历史行为）
 */
describe("副本名中英映射", () => {
  it("当前赛季 8 本全部收录且译名非空", () => {
    const current = [
      "Altar of Fangs",
      "Den of Nalorakk",
      "Murder Row",
      "The Blinding Vale",
      "Voidscar Arena",
      "King's Rest",
      "Temple of Sethraliss",
      "Ruby Life Pools",
    ];
    for (const en of current) {
      const zh = translateDungeonName(en);
      expect(zh, en).toBeTruthy();
      expect(zh, en).not.toBe(en);
    }
  });

  it("至暗之夜 12.0 第 1 赛季 8 本全部收录且译名非空", () => {
    const season1 = [
      "Magister's Terrace",
      "Maisara Caverns",
      "Nexus-Point Xenas",
      "Windrunner Spire",
      "Algeth'ar Academy",
      "Pit of Saron",
      "Seat of the Triumvirate",
      "Skyreach",
    ];
    for (const en of season1) {
      const zh = translateDungeonName(en);
      expect(zh, en).toBeTruthy();
      expect(zh, en).not.toBe(en);
    }
  });

  it("12.0 第 1 赛季新/回归副本译名样例（国服官方）", () => {
    expect(translateDungeonName("Magister's Terrace")).toBe("魔导师平台");
    expect(translateDungeonName("Maisara Caverns")).toBe("迈萨拉洞窟");
    expect(translateDungeonName("Nexus-Point Xenas")).toBe("节点希纳斯");
    expect(translateDungeonName("Windrunner Spire")).toBe("风行者之塔");
    expect(translateDungeonName("Pit of Saron")).toBe("萨隆矿坑");
    expect(translateDungeonName("Seat of the Triumvirate")).toBe("执政团之座");
  });

  it("zh 模式展示形式 = 国服纯中文译名", () => {
    expect(dungeonDisplayName("Altar of Fangs")).toBe("毒牙祭坛");
    expect(dungeonDisplayName("Algeth'ar Academy")).toBe("艾杰斯亚学院");
    expect(dungeonDisplayName("Mists of Tirna Scithe")).toBe("塞兹仙林的迷雾");
    expect(dungeonDisplayName("Grim Batol")).toBe("格瑞姆巴托");
    expect(dungeonDisplayName("The Stonevault")).toBe("矶石宝库");
  });

  it("未收录副本原样返回英文名（行为不变）", () => {
    expect(dungeonDisplayName("Some Brand New Dungeon")).toBe("Some Brand New Dungeon");
    expect(translateDungeonName("Some Brand New Dungeon")).toBeNull();
  });

  it("大小写与弯引号差异也能命中", () => {
    expect(translateDungeonName("algeth'ar academy")).toBe("艾杰斯亚学院");
    expect(translateDungeonName("King’s Rest")).toBe("诸王之眠"); // 弯引号 ’
  });

  it("Skyreach = 通天峰（用户实测反馈，已收录）", () => {
    expect(translateDungeonName("Skyreach")).toBe("通天峰");
    expect(dungeonDisplayName("Skyreach")).toBe("通天峰");
  });
});

describe("副本名语言切换（zh/en）", () => {
  it("zh 模式纯中文，未命中回退原文", () => {
    expect(dungeonDisplayName("Altar of Fangs", "zh")).toBe("毒牙祭坛");
    expect(dungeonDisplayName("Some Brand New Dungeon", "zh")).toBe("Some Brand New Dungeon");
  });

  it("en 模式纯英文（规范原名），未命中回退原文", () => {
    expect(dungeonDisplayName("Altar of Fangs", "en")).toBe("Altar of Fangs");
    expect(dungeonDisplayName("Some Brand New Dungeon", "en")).toBe("Some Brand New Dungeon");
  });

  it("Kings' Rest（撇号在 s 后）归一化命中诸王之眠", () => {
    expect(translateDungeonName("Kings' Rest")).toBe("诸王之眠");
    expect(dungeonDisplayName("Kings' Rest", "zh")).toBe("诸王之眠");
    expect(dungeonDisplayName("Kings' Rest", "en")).toBe("King's Rest"); // en 模式归一化为规范拼写
  });

  it("连字符变体也能命中（Nexus-Point Xenas）", () => {
    expect(translateDungeonName("Nexus-Point Xenas")).toBe("节点希纳斯");
    expect(translateDungeonName("Nexus Point Xenas")).toBe("节点希纳斯");
  });
});
