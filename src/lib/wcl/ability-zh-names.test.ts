import { describe, expect, it } from "vitest";
import {
  localizeAbilityNames,
  translateAbilityName,
} from "@/lib/wcl/ability-zh-names";

/**
 * 报告内专有名词中英映射（国服首发本地化）：
 *  - 战斗/爆发药水（Potion of ...，含各资料片）
 *  - 13 职业核心技能（爆发/CD/主要伤害/打断/减伤）
 *  - 常见团辅/增益效果（嗜血类、能量灌注等）
 *  - 展示形式 = 国服译名 + 英文原名括号（与职业/副本名一致）
 *  - 未收录原样返回英文（不报错、不改历史行为）
 *  - localizeAbilityNames 单次遍历最长优先，避免内嵌短名被嵌套替换
 */
describe("报告内专有名词中英映射", () => {
  it("药水样例（≥10）：国服译名 + 英文原名括号", () => {
    expect(translateAbilityName("Potion of Recklessness")).toBe("鲁莽药水（Potion of Recklessness）");
    expect(translateAbilityName("Potion of Prolonged Power")).toBe("延时之力药水（Potion of Prolonged Power）"); // 非"持久之力"
    expect(translateAbilityName("Potion of the Old War")).toBe("上古战神药水（Potion of the Old War）");
    expect(translateAbilityName("Potion of Intellect")).toBe("智力战斗药水（Potion of Intellect）");
    expect(translateAbilityName("Potion of Strength")).toBe("力量战斗药水（Potion of Strength）");
    expect(translateAbilityName("Potion of Agility")).toBe("敏捷战斗药水（Potion of Agility）");
    expect(translateAbilityName("Potion of Stamina")).toBe("耐力战斗药水（Potion of Stamina）");
    expect(translateAbilityName("Potion of Spectral Strength")).toBe("幽魂力量药水（Potion of Spectral Strength）");
    expect(translateAbilityName("Potion of Deathly Fixation")).toBe("死亡偏执药水（Potion of Deathly Fixation）");
    expect(translateAbilityName("Potion of Empowered Exorcisms")).toBe("强化驱魔药水（Potion of Empowered Exorcisms）"); // 非"驱邪"
    expect(translateAbilityName("Elemental Potion of Power")).toBe("元素强能药水（Elemental Potion of Power）");
    expect(translateAbilityName("Draenic Intellect Potion")).toBe("德拉诺智力药水（Draenic Intellect Potion）");
  });

  it("团辅/增益效果样例：嗜血类", () => {
    expect(translateAbilityName("Bloodlust")).toBe("嗜血（Bloodlust）");
    expect(translateAbilityName("Heroism")).toBe("英勇（Heroism）");
    expect(translateAbilityName("Time Warp")).toBe("时间扭曲（Time Warp）");
    expect(translateAbilityName("Ancient Hysteria")).toBe("远古狂乱（Ancient Hysteria）");
    expect(translateAbilityName("Power Infusion")).toBe("能量灌注（Power Infusion）");
  });

  it("13 职业核心技能各至少 1 条译名非空", () => {
    const samples: [string, string][] = [
      ["Avatar", "天神下凡"], // 战士
      ["Avenging Wrath", "复仇之怒"], // 圣骑士
      ["Bestial Wrath", "狂野怒火"], // 猎人
      ["Shadow Dance", "暗影之舞"], // 潜行者
      ["Voidform", "虚空形态"], // 牧师
      ["Pillar of Frost", "冰霜之柱"], // 死亡骑士
      ["Ascendance", "升腾"], // 萨满祭司
      ["Combustion", "燃烧"], // 法师
      ["Chaos Bolt", "混乱之箭"], // 术士
      ["Touch of Death", "轮回之触"], // 武僧
      ["Convoke the Spirits", "万灵之召"], // 德鲁伊
      ["Metamorphosis", "恶魔变形"], // 恶魔猎手
      ["Dragonrage", "狂龙之怒"], // 唤魔师
    ];
    for (const [en, zh] of samples) {
      expect(translateAbilityName(en), en).toBe(`${zh}（${en}）`);
    }
  });

  it("易错译名已按国服核实", () => {
    expect(translateAbilityName("Breath of Sindragosa")).toBe("冰龙吐息（Breath of Sindragosa）"); // 非繁中"辛德拉苟莎之息"
    expect(translateAbilityName("Mindbender")).toBe("摧心魔（Mindbender）"); // 非"心灵魔/屈心魔"
    expect(translateAbilityName("Touch of the Magi")).toBe("大法师之触（Touch of the Magi）"); // 非"法师之触"
    expect(translateAbilityName("Alter Time")).toBe("时光倒转（Alter Time）");
  });

  it("展示形式 = 国服译名 + 英文原名括号", () => {
    expect(translateAbilityName("Combustion")).toBe("燃烧（Combustion）");
    expect(translateAbilityName("Bloodlust")).toBe("嗜血（Bloodlust）");
  });

  it("大小写与多套写法均命中同一译名", () => {
    expect(translateAbilityName("combustion")).toBe("燃烧（Combustion）");
    expect(translateAbilityName("BLOODLUST")).toBe("嗜血（Bloodlust）");
    expect(translateAbilityName("PillarOfFrost")).toBe("冰霜之柱（Pillar of Frost）"); // 无空格驼峰
    expect(translateAbilityName("pillar of frost")).toBe("冰霜之柱（Pillar of Frost）");
  });

  it("未收录的专有名词原样返回英文（不报错、不改历史行为）", () => {
    expect(translateAbilityName("Some Brand New Ability")).toBe("Some Brand New Ability");
    expect(translateAbilityName("Potion of Spectral Fortitude")).toBe("Potion of Spectral Fortitude"); // 未核实条目不收录
    expect(localizeAbilityNames("使用 Some Unknown Potion 打爆发")).toBe("使用 Some Unknown Potion 打爆发");
    expect(localizeAbilityNames("")).toBe("");
  });

  it("localizeAbilityNames：正文替换英文名为译名（大小写不敏感）", () => {
    expect(localizeAbilityNames("5:36 使用 Combustion 对齐易伤")).toBe(
      "5:36 使用 燃烧（Combustion） 对齐易伤",
    );
    expect(localizeAbilityNames("爆发期间喝了 potion of recklessness")).toBe(
      "爆发期间喝了 鲁莽药水（Potion of Recklessness）",
    );
    expect(localizeAbilityNames("队伍嗜血 Bloodlust 已开")).toBe("队伍嗜血 嗜血（Bloodlust） 已开");
  });

  it("localizeAbilityNames：内嵌短名不被嵌套替换（最长优先单次遍历）", () => {
    expect(localizeAbilityNames("Rising Sun Kick 与 Kick 都算打断")).toBe(
      "旭日东升踢（Rising Sun Kick） 与 脚踢（Kick） 都算打断",
    );
    expect(localizeAbilityNames("Potion of Recklessness 与 Recklessness 同名不同类")).toBe(
      "鲁莽药水（Potion of Recklessness） 与 鲁莽（Recklessness） 同名不同类",
    );
    expect(localizeAbilityNames("Avenging Wrath 之后补 Wrath")).toBe(
      "复仇之怒（Avenging Wrath） 之后补 愤怒（Wrath）",
    );
  });
});
