import { describe, expect, it } from "vitest";
import { dungeonDisplayName, translateDungeonName } from "@/lib/wcl/dungeon-names";

/**
 * 副本名中英映射（本地验收缺陷修复）：
 *  - 至暗之夜 12.1 第 2 赛季全部 8 本均收录
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

  it("展示形式 = 国服译名 + 英文原名括号", () => {
    expect(dungeonDisplayName("Altar of Fangs")).toBe("毒牙祭坛（Altar of Fangs）");
    expect(dungeonDisplayName("Algeth'ar Academy")).toBe("艾杰斯亚学院（Algeth'ar Academy）");
    expect(dungeonDisplayName("Mists of Tirna Scithe")).toBe("塞兹仙林的迷雾（Mists of Tirna Scithe）");
    expect(dungeonDisplayName("Grim Batol")).toBe("格瑞姆巴托（Grim Batol）");
    expect(dungeonDisplayName("The Stonevault")).toBe("矶石宝库（The Stonevault）");
  });

  it("未收录副本原样返回英文名（行为不变）", () => {
    expect(dungeonDisplayName("Some Brand New Dungeon")).toBe("Some Brand New Dungeon");
    expect(translateDungeonName("Some Brand New Dungeon")).toBeNull();
  });

  it("大小写与弯引号差异也能命中", () => {
    expect(translateDungeonName("algeth'ar academy")).toBe("艾杰斯亚学院");
    expect(translateDungeonName("King’s Rest")).toBe("诸王之眠"); // 弯引号 ’
  });
});
