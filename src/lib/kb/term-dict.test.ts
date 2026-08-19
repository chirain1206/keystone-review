import { describe, expect, it } from "vitest";
import {
  GENERAL_TERMS,
  MONK_TERMS,
  getAllTerms,
  normalizeTerms,
} from "@/lib/kb/term-dict";

/**
 * 术语纠错层（FR-11 增强）验收：
 *  - 武僧错词/简称样本全部替换为标准名
 *  - 长词优先防嵌套（"怒雷破"不被改成"怒雷破破"）
 *  - 未命中文本原样不变
 *  - ability-zh-names 英文原名 → 中文标准名
 *  - 通用 lust 归一（英勇/Heroism → 嗜血）
 */

describe("武僧术语纠错（整词替换）", () => {
  it("全部错字/简称样本替换为标准名", () => {
    const samples: [string, string][] = [
      ["集分梯", "疾风踢"],
      ["门户掌", "猛虎掌"],
      ["门户章", "猛虎掌"],
      ["众神巨像", "众神聚心"],
      ["乾元之鳞", "乾元之巅"],
      ["擎人之巅", "乾元之巅"],
      ["倾天之巅", "乾元之巅"],
      ["震踏", "乾元镇踏"],
      ["乾元引踢", "乾元镇踏"],
      ["怒雷", "怒雷破"],
      ["神鹤", "神鹤引项踢"],
      ["旭日", "旭日东升踢"],
      ["升龙", "升龙霸"],
      ["生霸", "升龙霸"],
      ["生龙", "升龙霸"],
      ["天神玉身", "天神御身"],
      ["白虎", "白虎下凡"],
      ["幻灭", "幻灭踢"],
      ["赤精", "赤精之舞"],
    ];
    for (const [wrong, standard] of samples) {
      expect(normalizeTerms(wrong), `「${wrong}」应替换为「${standard}」`).toBe(standard);
    }
  });

  it("整句错词样本全部替换", () => {
    const input =
      "起手白虎下凡后接乾元之鳞与怒雷，众神巨像打断读条，随后集分梯、神鹤、旭日、升龙收尾";
    const out = normalizeTerms(input);
    expect(out).toContain("乾元之巅");
    expect(out).toContain("怒雷破");
    expect(out).toContain("众神聚心");
    expect(out).toContain("疾风踢");
    expect(out).toContain("神鹤引项踢");
    expect(out).toContain("旭日东升踢");
    expect(out).toContain("升龙霸");
    // 标准名保持不重复替换
    expect(out).not.toContain("怒雷破破");
    expect(out).not.toContain("乾元之巅之巅");
  });
});

describe("长词优先防嵌套", () => {
  it("标准名本身不被短别名截断", () => {
    // "怒雷破" 含短别名 "怒雷"，长词优先应保持原样
    expect(normalizeTerms("怒雷破")).toBe("怒雷破");
    expect(normalizeTerms("神鹤引项踢")).toBe("神鹤引项踢");
    expect(normalizeTerms("旭日东升踢")).toBe("旭日东升踢");
    expect(normalizeTerms("乾元之巅")).toBe("乾元之巅");
    expect(normalizeTerms("天神御身")).toBe("天神御身");
    expect(normalizeTerms("嗜血")).toBe("嗜血");
  });

  it("英文长名优先于内嵌短名", () => {
    // "Rising Sun Kick" 内嵌 "Kick"（潜行者的短名），长词优先不应拆
    expect(normalizeTerms("Rising Sun Kick")).toBe("旭日东升踢");
    // 单独 "Kick" 仍按潜行者技能译名处理
    expect(normalizeTerms("Kick")).toBe("脚踢");
  });
});

describe("未命中不变", () => {
  it("词典外文本原样返回", () => {
    expect(normalizeTerms("随便写的一段话，没有术语。")).toBe("随便写的一段话，没有术语。");
    expect(normalizeTerms("")).toBe("");
  });
});

describe("ability-zh-names 英文→中文标准名", () => {
  it("英文技能名替换为国服标准名", () => {
    expect(normalizeTerms("Fists of Fury")).toBe("怒雷破");
    expect(normalizeTerms("Tiger Palm")).toBe("猛虎掌");
    expect(normalizeTerms("Blackout Kick")).toBe("幻灭踢");
    expect(normalizeTerms("Spinning Crane Kick")).toBe("神鹤引项踢");
    expect(normalizeTerms("Whirling Dragon Punch")).toBe("升龙霸");
    expect(normalizeTerms("Invoke Xuen")).toBe("白虎下凡");
  });

  it("大小写不敏感", () => {
    expect(normalizeTerms("fists of fury")).toBe("怒雷破");
    expect(normalizeTerms("RISING SUN KICK")).toBe("旭日东升踢");
  });
});

describe("通用 lust 归一", () => {
  it("英勇/血性狂怒 → 嗜血；Heroism 亦归入嗜血", () => {
    expect(normalizeTerms("英勇")).toBe("嗜血");
    expect(normalizeTerms("血性狂怒")).toBe("嗜血");
    // 因 "英勇" 已被降级为 "嗜血" 的别名，其英文原名 Heroism 一并归入嗜血
    expect(normalizeTerms("Heroism")).toBe("嗜血");
    expect(normalizeTerms("Bloodlust")).toBe("嗜血");
  });
});

describe("词典规模与合并一致性", () => {
  it("武僧显式术语 13 条、通用 1 条、合并词典含全部标准名", () => {
    expect(MONK_TERMS).toHaveLength(13);
    expect(GENERAL_TERMS).toHaveLength(1);

    const all = getAllTerms();
    // 合并词典包含武僧标准名与通用标准名
    const standards = new Set(all.map((t) => t.standard));
    for (const t of MONK_TERMS) expect(standards.has(t.standard)).toBe(true);
    expect(standards.has("嗜血")).toBe(true);

    // 别名不应同时作为标准（降级一致："英勇" 是别名而非标准）
    expect(standards.has("英勇")).toBe(false);
    expect(standards.has("怒雷")).toBe(false);
    expect(standards.has("旭日")).toBe(false);
  });
});
