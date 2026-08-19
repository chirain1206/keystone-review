import { describe, expect, it } from "vitest";
import {
  classDisplayName,
  classSpecDisplayName,
  specDisplayName,
  translateClassName,
  translateSpecName,
} from "@/lib/wcl/class-spec-names";

/**
 * 职业/专精名中英映射（国服首发本地化）：
 *  - 13 职业全收录（含 WCL 无空格驼峰与本地解析器带空格两套写法）
 *  - 全部专精（当前 39 + 历史 2）收录
 *  - 展示形式 = 国服译名 + 英文原名括号
 *  - 未收录原样返回英文（不报错、不改变历史行为）
 */
describe("职业/专精名中英映射", () => {
  it("13 职业全部收录且译名非空", () => {
    const classes = [
      "Warrior",
      "Paladin",
      "Hunter",
      "Rogue",
      "Priest",
      "Death Knight",
      "Shaman",
      "Mage",
      "Warlock",
      "Monk",
      "Druid",
      "Demon Hunter",
      "Evoker",
    ];
    for (const en of classes) {
      const zh = translateClassName(en);
      expect(zh, en).toBeTruthy();
      expect(zh, en).not.toBe(en);
    }
  });

  it("职业译名样例（国服官方）", () => {
    expect(translateClassName("Warrior")).toBe("战士");
    expect(translateClassName("Death Knight")).toBe("死亡骑士");
    expect(translateClassName("Demon Hunter")).toBe("恶魔猎手");
    expect(translateClassName("Shaman")).toBe("萨满祭司");
    expect(translateClassName("Rogue")).toBe("潜行者");
    expect(translateClassName("Evoker")).toBe("唤魔师");
  });

  it("WCL 无空格驼峰写法与本地带空格写法均命中同一译名", () => {
    expect(translateClassName("DeathKnight")).toBe("死亡骑士");
    expect(translateClassName("Death Knight")).toBe("死亡骑士");
    expect(translateClassName("DemonHunter")).toBe("恶魔猎手");
    expect(translateClassName("Demon Hunter")).toBe("恶魔猎手");
    expect(classDisplayName("DeathKnight")).toBe("死亡骑士（Death Knight）");
    expect(classDisplayName("Death Knight")).toBe("死亡骑士（Death Knight）");
  });

  it("全部专精收录且译名非空", () => {
    const specs = [
      // 战士
      "Arms", "Fury", "Protection",
      // 圣骑士
      "Holy", "Retribution",
      // 猎人
      "Beast Mastery", "Marksmanship", "Survival",
      // 潜行者
      "Assassination", "Outlaw", "Subtlety",
      // 牧师
      "Discipline", "Shadow",
      // 死亡骑士
      "Blood", "Frost", "Unholy",
      // 萨满祭司
      "Elemental", "Enhancement", "Restoration",
      // 法师
      "Arcane", "Fire",
      // 术士
      "Affliction", "Demonology", "Destruction",
      // 武僧
      "Brewmaster", "Mistweaver", "Windwalker",
      // 德鲁伊
      "Balance", "Feral", "Guardian",
      // 恶魔猎手
      "Havoc", "Vengeance",
      // 唤魔师
      "Devastation", "Preservation", "Augmentation",
      // 历史专精
      "Combat", "Feral Combat",
    ];
    for (const en of specs) {
      const zh = translateSpecName(en);
      expect(zh, en).toBeTruthy();
      expect(zh, en).not.toBe(en);
    }
  });

  it("专精译名样例（国服官方，含易错项）", () => {
    expect(translateSpecName("Unholy")).toBe("邪恶");
    expect(translateSpecName("Beast Mastery")).toBe("野兽控制");
    expect(translateSpecName("BeastMastery")).toBe("野兽控制"); // 无空格写法
    expect(translateSpecName("Brewmaster")).toBe("酒仙");
    expect(translateSpecName("Demonology")).toBe("恶魔学识");
    expect(translateSpecName("Preservation")).toBe("恩护"); // 官方"恩护"而非"保护"
    expect(translateSpecName("Augmentation")).toBe("增辉");
    expect(translateSpecName("Devastation")).toBe("湮灭");
    expect(translateSpecName("Outlaw")).toBe("狂徒");
  });

  it("展示形式 = 国服译名 + 英文原名括号", () => {
    expect(classDisplayName("Mage")).toBe("法师（Mage）");
    expect(specDisplayName("Fire")).toBe("火焰（Fire）");
    expect(specDisplayName("Beast Mastery")).toBe("野兽控制（Beast Mastery）");
    expect(classDisplayName("DeathKnight")).toBe("死亡骑士（Death Knight）");
  });

  it("组合展示：职业 + 专精，Unknown/空跳过", () => {
    expect(classSpecDisplayName("DeathKnight", "Unholy")).toBe(
      "死亡骑士（Death Knight） 邪恶（Unholy）",
    );
    expect(classSpecDisplayName("Mage", "Unknown")).toBe("法师（Mage）");
    expect(classSpecDisplayName("Mage", "")).toBe("法师（Mage）");
    expect(classSpecDisplayName("Unknown", "Fire")).toBe("火焰（Fire）");
    expect(classSpecDisplayName("Unknown", "Unknown")).toBe("Unknown");
  });

  it("未收录职业/专精原样返回英文名（行为不变、不报错）", () => {
    expect(translateClassName("SomeNewClass")).toBeNull();
    expect(classDisplayName("SomeNewClass")).toBe("SomeNewClass");
    expect(translateSpecName("SomeNewSpec")).toBeNull();
    expect(specDisplayName("SomeNewSpec")).toBe("SomeNewSpec");
  });

  it("大小写差异也能命中", () => {
    expect(translateClassName("deathknight")).toBe("死亡骑士");
    expect(translateSpecName("unholy")).toBe("邪恶");
    expect(translateSpecName("BEAST MASTERY")).toBe("野兽控制");
  });
});
