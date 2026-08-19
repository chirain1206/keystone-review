/**
 * 报告内专有名词中英映射（国服语境）：技能名 / 药水名 / 增益效果名。
 *
 * 分析报告正文里的技能名/药水名等专有名词（如 "Potion of Recklessness"）原为
 * 游戏内英文原名，国服用户对不上。本模块提供 "国服译名（英文原名）" 的显示形式，
 * 与职业/专精名（class-spec-names.ts）、副本名（dungeon-names.ts）风格一致。
 *
 * 边界说明：
 *  - 结构化数据（ProcessedLog）与 AI 提示词仍保留游戏内英文原名（见 PRD
 *    "技能/副本名保留游戏内原名"），判定与知识检索都基于英文原名，不做翻译；
 *  - 本模块只对"报告正文 / 问答回答"这一展示文本做译名替换（localizeAbilityNames），
 *    是纯展示层本地化，不改变 AI 输入、意图判定与历史行为；
 *  - 这是"高频词映射库"（首发本地化），不是全量能力库（几万条）；全量后续接
 *    开放数据源（wowhead / WCL gameData）补充。
 *
 * 译名核实来源（国服官方简体中文，逐条对照，每个条目的 source 字段标注主要来源）：
 *  - 药水：cn.wowhead.com 物品页 + 灰机wiki（注意国服旧译/新译差异）
 *  - 技能：cn.wowhead.com 技能页 + 灰机wiki + 百度百科 + ol.3dmgame 攻略库 +
 *    db.178.com + NGA
 *  - 增益：cn.wowhead.com 技能页（Bloodlust=嗜血、Heroism=英勇 等）
 *
 * 易错译名已单独核实（见相应条目注释）：
 *  - Potion of Recklessness 国服至今仍为"鲁莽药水"（无新译）
 *  - Potion of Prolonged Power 国服=延时之力药水（繁中才是"持久之力"）
 *  - Potion of the Old War 国服=上古战神药水；Potion of Deathly Fixation=死亡偏执药水
 *  - Potion of Empowered Exorcisms 国服=强化"驱魔"药水（非"驱邪"）
 *  - Breath of Sindragosa 国服=冰龙吐息（繁中才是"辛德拉苟莎之息"）
 *  - Mindbender 国服=摧心魔；Touch of the Magi 国服=大法师之触；Alter Time=时光倒转
 */

export interface AbilityNameEntry {
  /** 规范英文原名（游戏内写法，带空格，如 "Potion of Recklessness"）。 */
  en: string;
  /** 国服官方简体中文译名。 */
  zh: string;
  /** 主要核实来源（短标注）。 */
  source: string;
}

/** 战斗/爆发药水（Potion of ...，含各资料片）。 */
const POTION_ENTRIES: AbilityNameEntry[] = [
  // 经典 / 军团再临 / 争霸艾泽拉斯
  { en: "Potion of Recklessness", zh: "鲁莽药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Prolonged Power", zh: "延时之力药水", source: "cn.wowhead.com 物品页" }, // 繁中"持久之力"
  { en: "Potion of the Old War", zh: "上古战神药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Unbridled Fury", zh: "无拘之怒药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Rising Death", zh: "死亡崛起药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Bursting Blood", zh: "鲜血喷发药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Deadly Grace", zh: "致命优雅药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Phantom Fire", zh: "幻影火焰药水", source: "灰机wiki" },
  { en: "Potion of Replenishment", zh: "滋养药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Intellect", zh: "智力战斗药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Strength", zh: "力量战斗药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Agility", zh: "敏捷战斗药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Stamina", zh: "耐力战斗药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Speed", zh: "速度药水", source: "cn.wowhead.com 物品页" },
  // 暗影国度
  { en: "Potion of Spectral Strength", zh: "幽魂力量药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Spectral Agility", zh: "幽魂敏捷药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Spectral Intellect", zh: "幽魂智力药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Spectral Stamina", zh: "幽魂耐力药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Deathly Fixation", zh: "死亡偏执药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Empowered Exorcisms", zh: "强化驱魔药水", source: "cn.wowhead.com 物品页" }, // 非"驱邪"
  { en: "Potion of the Hidden Spirit", zh: "隐秘精魂药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Hardened Shadows", zh: "硬化暗影药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Spiritual Clarity", zh: "灵魂神智药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Sacrificial Anima", zh: "献祭心能药水", source: "cn.wowhead.com 物品页" },
  // 巨龙时代
  { en: "Potion of Frozen Focus", zh: "冻结专注药水", source: "cn.wowhead.com 物品页" },
  { en: "Potion of Shocking Disclosure", zh: "震击揭示药水", source: "cn.wowhead.com 物品页" },
  { en: "Elemental Potion of Ultimate Power", zh: "元素究极强能药水", source: "cn.wowhead.com 物品页" },
  { en: "Elemental Potion of Power", zh: "元素强能药水", source: "cn.wowhead.com 物品页" },
  // 地心之战
  { en: "Potion of Unwavering Focus", zh: "专心致志药水", source: "cn.wowhead.com 物品页" },
  // 德拉诺之王
  { en: "Draenic Intellect Potion", zh: "德拉诺智力药水", source: "cn.wowhead.com 物品页" },
  { en: "Draenic Strength Potion", zh: "德拉诺力量药水", source: "cn.wowhead.com 物品页" },
  { en: "Draenic Agility Potion", zh: "德拉诺敏捷药水", source: "cn.wowhead.com 物品页" },
];

/** 常见团辅/增益效果名。 */
const EFFECT_ENTRIES: AbilityNameEntry[] = [
  { en: "Bloodlust", zh: "嗜血", source: "cn.wowhead.com 技能页" },
  { en: "Heroism", zh: "英勇", source: "cn.wowhead.com 技能页" },
  { en: "Time Warp", zh: "时间扭曲", source: "cn.wowhead.com 技能页" },
  { en: "Ancient Hysteria", zh: "远古狂乱", source: "cn.wowhead.com 技能页" },
  { en: "Fury of the Aspects", zh: "守护巨龙之怒", source: "cn.wowhead.com 技能页" },
  { en: "Power Infusion", zh: "能量灌注", source: "cn.wowhead.com 技能页" },
  { en: "Blessing of Seasons", zh: "四季祝福", source: "cn.wowhead.com 技能页" },
];

/** 各职业核心技能（爆发/CD/主要伤害/打断/减伤）。 */
const ABILITY_ENTRIES: AbilityNameEntry[] = [
  // ── 战士 Warrior ──
  { en: "Avatar", zh: "天神下凡", source: "百度百科" },
  { en: "Recklessness", zh: "鲁莽", source: "cn.wowhead.com 技能页" },
  { en: "Ravager", zh: "破坏者", source: "百度百科" },
  { en: "Bladestorm", zh: "剑刃风暴", source: "cn.wowhead.com 技能页" },
  { en: "Colossus Smash", zh: "巨人打击", source: "cn.wowhead.com 技能页" },
  { en: "Spear of Bastion", zh: "晋升堡垒之矛", source: "cn.wowhead.com 技能页" },
  { en: "Thunderous Roar", zh: "雷霆咆哮", source: "cn.wowhead.com 技能页" },
  { en: "Shield Wall", zh: "盾墙", source: "cn.wowhead.com 技能页" },
  { en: "Last Stand", zh: "破釜沉舟", source: "cn.wowhead.com 技能页" },
  { en: "Demoralizing Shout", zh: "挫志怒吼", source: "cn.wowhead.com 技能页" },
  { en: "Rallying Cry", zh: "集结呐喊", source: "cn.wowhead.com 技能页" },
  { en: "Spell Reflection", zh: "法术反射", source: "cn.wowhead.com 技能页" },
  { en: "Die by the Sword", zh: "剑在人在", source: "cn.wowhead.com 技能页" },
  { en: "Enraged Regeneration", zh: "狂怒回复", source: "db.178.com" },
  { en: "Ignore Pain", zh: "无视苦痛", source: "cn.wowhead.com 技能页" },
  { en: "Pummel", zh: "拳击", source: "cn.wowhead.com 技能页" },
  { en: "Mortal Strike", zh: "致死打击", source: "cn.wowhead.com 技能页" },
  { en: "Overpower", zh: "压制", source: "cn.wowhead.com 技能页" },
  { en: "Raging Blow", zh: "怒击", source: "cn.wowhead.com 技能页" },
  { en: "Bloodthirst", zh: "嗜血", source: "cn.wowhead.com 技能页" },
  { en: "Execute", zh: "斩杀", source: "cn.wowhead.com 技能页" },
  { en: "Whirlwind", zh: "旋风斩", source: "cn.wowhead.com 技能页" },

  // ── 圣骑士 Paladin ──
  { en: "Avenging Wrath", zh: "复仇之怒", source: "cn.wowhead.com 技能页" },
  { en: "Crusade", zh: "征伐", source: "cn.wowhead.com 技能页" },
  { en: "Divine Toll", zh: "圣洁鸣钟", source: "cn.wowhead.com 技能页" },
  { en: "Wake of Ashes", zh: "灰烬觉醒", source: "cn.wowhead.com 技能页" },
  { en: "Final Reckoning", zh: "最终清算", source: "cn.wowhead.com 技能页" },
  { en: "Execution Sentence", zh: "处决宣判", source: "cn.wowhead.com 技能页" },
  { en: "Guardian of Ancient Kings", zh: "远古列王守卫", source: "cn.wowhead.com 技能页" },
  { en: "Sentinel", zh: "戒卫", source: "cn.wowhead.com 技能页" },
  { en: "Divine Shield", zh: "圣盾术", source: "cn.wowhead.com 技能页" },
  { en: "Blessing of Protection", zh: "保护祝福", source: "cn.wowhead.com 技能页" },
  { en: "Blessing of Spellwarding", zh: "破咒祝福", source: "cn.wowhead.com 技能页" },
  { en: "Blessing of Freedom", zh: "自由祝福", source: "cn.wowhead.com 技能页" },
  { en: "Lay on Hands", zh: "圣疗术", source: "cn.wowhead.com 技能页" },
  { en: "Ardent Defender", zh: "炽热防御者", source: "cn.wowhead.com 技能页" },
  { en: "Rebuke", zh: "责难", source: "cn.wowhead.com 技能页" },
  { en: "Templar's Verdict", zh: "圣殿骑士的裁决", source: "ol.3dmgame.com" },
  { en: "Judgment", zh: "审判", source: "cn.wowhead.com 技能页" },
  { en: "Hammer of Wrath", zh: "愤怒之锤", source: "百度百科" },
  { en: "Divine Storm", zh: "神圣风暴", source: "cn.wowhead.com 技能页" },

  // ── 猎人 Hunter ──
  { en: "Bestial Wrath", zh: "狂野怒火", source: "cn.wowhead.com 技能页" },
  { en: "Aspect of the Wild", zh: "野性守护", source: "百度百科" },
  { en: "Trueshot", zh: "百发百中", source: "cn.wowhead.com 技能页" },
  { en: "Coordinated Assault", zh: "协同进攻", source: "cn.wowhead.com 技能页" },
  { en: "Call of the Wild", zh: "野性呼唤", source: "cn.wowhead.com 技能页" },
  { en: "Camouflage", zh: "伪装", source: "cn.wowhead.com 技能页" },
  { en: "Exhilaration", zh: "意气风发", source: "cn.wowhead.com 技能页" },
  { en: "Survival of the Fittest", zh: "适者生存", source: "cn.wowhead.com 技能页" },
  { en: "Aspect of the Turtle", zh: "灵龟守护", source: "cn.wowhead.com 技能页" },
  { en: "Aspect of the Cheetah", zh: "猎豹守护", source: "cn.wowhead.com 技能页" },
  { en: "Counter Shot", zh: "反制射击", source: "cn.wowhead.com 技能页" },
  { en: "Muzzle", zh: "压制", source: "cn.wowhead.com 技能页" },
  { en: "Kill Command", zh: "杀戮命令", source: "cn.wowhead.com 技能页" },
  { en: "Cobra Shot", zh: "眼镜蛇射击", source: "cn.wowhead.com 技能页" },
  { en: "Aimed Shot", zh: "瞄准射击", source: "cn.wowhead.com 技能页" },
  { en: "Arcane Shot", zh: "奥术射击", source: "cn.wowhead.com 技能页" },
  { en: "Rapid Fire", zh: "急速射击", source: "cn.wowhead.com 技能页" },
  { en: "Barbed Shot", zh: "倒刺射击", source: "cn.wowhead.com 技能页" },
  { en: "Kill Shot", zh: "杀戮射击", source: "cn.wowhead.com 技能页" },

  // ── 潜行者 Rogue ──
  { en: "Adrenaline Rush", zh: "冲动", source: "cn.wowhead.com 技能页" },
  { en: "Blade Flurry", zh: "剑刃乱舞", source: "cn.wowhead.com 技能页" },
  { en: "Shadow Blades", zh: "暗影之刃", source: "cn.wowhead.com 技能页" },
  { en: "Vendetta", zh: "仇杀", source: "cn.wowhead.com 技能页" },
  { en: "Symbols of Death", zh: "死亡征兆", source: "cn.wowhead.com 技能页" },
  { en: "Shadow Dance", zh: "暗影之舞", source: "cn.wowhead.com 技能页" },
  { en: "Evasion", zh: "闪避", source: "cn.wowhead.com 技能页" },
  { en: "Feint", zh: "佯攻", source: "cn.wowhead.com 技能页" },
  { en: "Cloak of Shadows", zh: "暗影斗篷", source: "cn.wowhead.com 技能页" },
  { en: "Crimson Vial", zh: "猩红之瓶", source: "cn.wowhead.com 技能页" },
  { en: "Kick", zh: "脚踢", source: "cn.wowhead.com 技能页" },
  { en: "Sinister Strike", zh: "影袭", source: "cn.wowhead.com 技能页" },
  { en: "Backstab", zh: "背刺", source: "cn.wowhead.com 技能页" },
  { en: "Eviscerate", zh: "剔骨", source: "cn.wowhead.com 技能页" },
  { en: "Envenom", zh: "毒伤", source: "cn.wowhead.com 技能页" },
  { en: "Rupture", zh: "割裂", source: "cn.wowhead.com 技能页" },
  { en: "Dispatch", zh: "抹杀", source: "cn.wowhead.com 技能页" },
  { en: "Between the Eyes", zh: "正中眉心", source: "cn.wowhead.com 技能页" },

  // ── 牧师 Priest ──
  { en: "Apotheosis", zh: "神化", source: "cn.wowhead.com 技能页" },
  { en: "Voidform", zh: "虚空形态", source: "cn.wowhead.com 技能页" },
  { en: "Vampiric Embrace", zh: "吸血鬼之拥", source: "cn.wowhead.com 技能页" },
  { en: "Surge of Light", zh: "圣光涌动", source: "cn.wowhead.com 技能页" },
  { en: "Guardian Spirit", zh: "守护之魂", source: "cn.wowhead.com 技能页" },
  { en: "Divine Hymn", zh: "神圣赞美诗", source: "cn.wowhead.com 技能页" },
  { en: "Power Word: Barrier", zh: "真言术：障", source: "cn.wowhead.com 技能页" },
  { en: "Fade", zh: "渐隐术", source: "cn.wowhead.com 技能页" },
  { en: "Pain Suppression", zh: "痛苦压制", source: "cn.wowhead.com 技能页" },
  { en: "Angelic Feather", zh: "天使之羽", source: "cn.wowhead.com 技能页" },
  { en: "Shadow Covenant", zh: "暗影盟约", source: "cn.wowhead.com 技能页" },
  { en: "Vampiric Touch", zh: "吸血鬼之触", source: "cn.wowhead.com 技能页" },
  { en: "Shadowfiend", zh: "暗影魔", source: "cn.wowhead.com 技能页" },
  { en: "Mindbender", zh: "摧心魔", source: "cn.wowhead.com 技能页" }, // 非"心灵魔/屈心魔"
  { en: "Mind Blast", zh: "心灵震爆", source: "cn.wowhead.com 技能页" },
  { en: "Mind Flay", zh: "精神鞭笞", source: "cn.wowhead.com 技能页" },
  { en: "Devouring Plague", zh: "噬灵疫病", source: "cn.wowhead.com 技能页" },
  { en: "Void Bolt", zh: "虚空箭", source: "cn.wowhead.com 技能页" },
  { en: "Shadow Word: Death", zh: "暗言术：灭", source: "cn.wowhead.com 技能页" },
  { en: "Silence", zh: "沉默", source: "cn.wowhead.com 技能页" },

  // ── 死亡骑士 Death Knight ──
  { en: "Pillar of Frost", zh: "冰霜之柱", source: "cn.wowhead.com 技能页" },
  { en: "Breath of Sindragosa", zh: "冰龙吐息", source: "cn.wowhead.com 技能页" }, // 繁中"辛德拉苟莎之息"
  { en: "Raise Abomination", zh: "培育憎恶", source: "cn.wowhead.com 技能页" },
  { en: "Frostwyrm's Fury", zh: "冰霜巨龙之怒", source: "cn.wowhead.com 技能页" },
  { en: "Icebound Fortitude", zh: "冰封之韧", source: "cn.wowhead.com 技能页" },
  { en: "Anti-Magic Shell", zh: "反魔法护罩", source: "cn.wowhead.com 技能页" },
  { en: "Anti-Magic Zone", zh: "反魔法领域", source: "cn.wowhead.com 技能页" },
  { en: "Lichborne", zh: "巫妖之躯", source: "cn.wowhead.com 技能页" },
  { en: "Vampiric Blood", zh: "吸血鬼之血", source: "cn.wowhead.com 技能页" },
  { en: "Dancing Rune Weapon", zh: "符文刃舞", source: "cn.wowhead.com 技能页" },
  { en: "Rune Tap", zh: "符文分流", source: "cn.wowhead.com 技能页" },
  { en: "Abomination Limb", zh: "憎恶附肢", source: "cn.wowhead.com 技能页" },
  { en: "Unholy Assault", zh: "邪恶突袭", source: "cn.wowhead.com 技能页" },
  { en: "Mind Freeze", zh: "心灵冰冻", source: "cn.wowhead.com 技能页" },
  { en: "Obliterate", zh: "湮灭", source: "cn.wowhead.com 技能页" },
  { en: "Frost Strike", zh: "冰霜打击", source: "cn.wowhead.com 技能页" },
  { en: "Howling Blast", zh: "凛风冲击", source: "cn.wowhead.com 技能页" },
  { en: "Scourge Strike", zh: "天灾打击", source: "cn.wowhead.com 技能页" },
  { en: "Festering Strike", zh: "脓疮打击", source: "cn.wowhead.com 技能页" },
  { en: "Death Coil", zh: "死亡缠绕", source: "cn.wowhead.com 技能页" },
  { en: "Death Strike", zh: "灵界打击", source: "cn.wowhead.com 技能页" },

  // ── 萨满祭司 Shaman ──
  { en: "Ascendance", zh: "升腾", source: "cn.wowhead.com 技能页" },
  { en: "Spiritwalker's Grace", zh: "灵魂行者的恩赐", source: "cn.wowhead.com 技能页" },
  { en: "Ancestral Guidance", zh: "先祖指引", source: "cn.wowhead.com 技能页" },
  { en: "Spirit Link Totem", zh: "灵魂链接图腾", source: "cn.wowhead.com 技能页" },
  { en: "Healing Tide Totem", zh: "治疗之潮图腾", source: "cn.wowhead.com 技能页" },
  { en: "Cloudburst Totem", zh: "暴雨图腾", source: "cn.wowhead.com 技能页" },
  { en: "Stone Bulwark Totem", zh: "石壁图腾", source: "cn.wowhead.com 技能页" },
  { en: "Astral Shift", zh: "星界转移", source: "cn.wowhead.com 技能页" },
  { en: "Feral Spirit", zh: "野性狼魂", source: "cn.wowhead.com 技能页" },
  { en: "Primordial Wave", zh: "始源之潮", source: "cn.wowhead.com 技能页" },
  { en: "Stormkeeper", zh: "风暴守护者", source: "cn.wowhead.com 技能页" },
  { en: "Deeply Rooted Elements", zh: "根深蒂固的元素", source: "cn.wowhead.com 技能页" },
  { en: "Wind Shear", zh: "风剪", source: "cn.wowhead.com 技能页" },
  { en: "Lava Burst", zh: "熔岩爆裂", source: "cn.wowhead.com 技能页" },
  { en: "Lightning Bolt", zh: "闪电箭", source: "cn.wowhead.com 技能页" },
  { en: "Chain Lightning", zh: "闪电链", source: "cn.wowhead.com 技能页" },
  { en: "Stormstrike", zh: "风暴打击", source: "cn.wowhead.com 技能页" },
  { en: "Lava Lash", zh: "熔岩猛击", source: "cn.wowhead.com 技能页" },
  { en: "Flame Shock", zh: "烈焰震击", source: "cn.wowhead.com 技能页" },
  { en: "Earth Shock", zh: "大地震击", source: "cn.wowhead.com 技能页" },
  { en: "Frost Shock", zh: "冰霜震击", source: "cn.wowhead.com 技能页" },

  // ── 法师 Mage ──
  { en: "Combustion", zh: "燃烧", source: "cn.wowhead.com 技能页" },
  { en: "Icy Veins", zh: "冰冷血脉", source: "cn.wowhead.com 技能页" },
  { en: "Arcane Power", zh: "奥术强化", source: "cn.wowhead.com 技能页" },
  { en: "Arcane Surge", zh: "奥术涌动", source: "cn.wowhead.com 技能页" },
  { en: "Rune of Power", zh: "能量符文", source: "cn.wowhead.com 技能页" },
  { en: "Radiant Spark", zh: "璀璨火花", source: "cn.wowhead.com 技能页" },
  { en: "Touch of the Magi", zh: "大法师之触", source: "cn.wowhead.com 技能页" }, // 非"法师之触"
  { en: "Mass Barrier", zh: "群体屏障", source: "cn.wowhead.com 技能页" },
  { en: "Mass Invisibility", zh: "群体隐形", source: "cn.wowhead.com 技能页" },
  { en: "Alter Time", zh: "时光倒转", source: "cn.wowhead.com 技能页" },
  { en: "Counterspell", zh: "法术反制", source: "cn.wowhead.com 技能页" },
  { en: "Fireball", zh: "火球术", source: "cn.wowhead.com 技能页" },
  { en: "Pyroblast", zh: "炎爆术", source: "cn.wowhead.com 技能页" },
  { en: "Flamestrike", zh: "烈焰风暴", source: "cn.wowhead.com 技能页" },
  { en: "Frostbolt", zh: "寒冰箭", source: "cn.wowhead.com 技能页" },
  { en: "Ice Lance", zh: "冰枪术", source: "cn.wowhead.com 技能页" },
  { en: "Arcane Blast", zh: "奥术冲击", source: "cn.wowhead.com 技能页" },
  { en: "Arcane Missiles", zh: "奥术飞弹", source: "cn.wowhead.com 技能页" },
  { en: "Arcane Barrage", zh: "奥术弹幕", source: "cn.wowhead.com 技能页" },

  // ── 术士 Warlock ──
  { en: "Dark Ascension", zh: "黑暗升华", source: "cn.wowhead.com 技能页" },
  { en: "Summon Infernal", zh: "召唤地狱火", source: "cn.wowhead.com 技能页" },
  { en: "Summon Darkglare", zh: "召唤黑眼", source: "cn.wowhead.com 技能页" },
  { en: "Summon Demonic Tyrant", zh: "召唤恶魔暴君", source: "ol.3dmgame.com" },
  { en: "Dark Pact", zh: "黑暗契约", source: "ol.3dmgame.com" },
  { en: "Unending Resolve", zh: "不灭决心", source: "ol.3dmgame.com" },
  { en: "Nether Ward", zh: "虚空守卫", source: "ol.3dmgame.com" },
  { en: "Spell Lock", zh: "法术封锁", source: "ol.3dmgame.com" },
  { en: "Axe Toss", zh: "巨斧投掷", source: "ol.3dmgame.com" },
  { en: "Shadow Bolt", zh: "暗影箭", source: "ol.3dmgame.com" },
  { en: "Incinerate", zh: "烧尽", source: "ol.3dmgame.com" },
  { en: "Chaos Bolt", zh: "混乱之箭", source: "ol.3dmgame.com" },
  { en: "Immolate", zh: "献祭", source: "ol.3dmgame.com" },
  { en: "Corruption", zh: "腐蚀术", source: "ol.3dmgame.com" },
  { en: "Agony", zh: "痛楚", source: "ol.3dmgame.com" },
  { en: "Unstable Affliction", zh: "痛苦无常", source: "ol.3dmgame.com" },
  { en: "Hand of Gul'dan", zh: "古尔丹之手", source: "ol.3dmgame.com" },
  { en: "Demonbolt", zh: "恶魔之箭", source: "ol.3dmgame.com" },

  // ── 武僧 Monk ──
  { en: "Storm, Earth, and Fire", zh: "风火雷电", source: "cn.wowhead.com 技能页" },
  { en: "Serenity", zh: "屏气凝神", source: "cn.wowhead.com 技能页" },
  { en: "Invoke Xuen", zh: "白虎下凡", source: "cn.wowhead.com 技能页" },
  { en: "Touch of Death", zh: "轮回之触", source: "cn.wowhead.com 技能页" },
  { en: "Fortifying Brew", zh: "壮胆酒", source: "cn.wowhead.com 技能页" },
  { en: "Dampen Harm", zh: "躯不坏", source: "cn.wowhead.com 技能页" },
  { en: "Diffuse Magic", zh: "散魔功", source: "cn.wowhead.com 技能页" },
  { en: "Zen Meditation", zh: "禅悟冥想", source: "cn.wowhead.com 技能页" },
  { en: "Spear Hand Strike", zh: "贯日击", source: "cn.wowhead.com 技能页" },
  { en: "Rising Sun Kick", zh: "旭日东升踢", source: "cn.wowhead.com 技能页" },
  { en: "Fists of Fury", zh: "怒雷破", source: "cn.wowhead.com 技能页" },
  { en: "Blackout Kick", zh: "幻灭踢", source: "NGA" },
  { en: "Tiger Palm", zh: "猛虎掌", source: "NGA" },
  { en: "Spinning Crane Kick", zh: "神鹤引项踢", source: "cn.wowhead.com 技能页" },
  { en: "Whirling Dragon Punch", zh: "升龙霸", source: "cn.wowhead.com 技能页" },

  // ── 德鲁伊 Druid ──
  { en: "Celestial Alignment", zh: "超凡之盟", source: "ol.3dmgame.com" },
  { en: "Incarnation", zh: "化身", source: "ol.3dmgame.com" },
  { en: "Convoke the Spirits", zh: "万灵之召", source: "ol.3dmgame.com" },
  { en: "Berserk", zh: "狂暴", source: "ol.3dmgame.com" },
  { en: "Tiger's Fury", zh: "猛虎之怒", source: "ol.3dmgame.com" },
  { en: "Ravenous Frenzy", zh: "饕餮狂乱", source: "ol.3dmgame.com" },
  { en: "Heart of the Wild", zh: "野性之心", source: "ol.3dmgame.com" },
  { en: "Bear Form", zh: "熊形态", source: "ol.3dmgame.com" },
  { en: "Ironfur", zh: "铁鬃", source: "ol.3dmgame.com" },
  { en: "Frenzied Regeneration", zh: "狂暴回复", source: "ol.3dmgame.com" },
  { en: "Barkskin", zh: "树皮术", source: "ol.3dmgame.com" },
  { en: "Survival Instincts", zh: "生存本能", source: "ol.3dmgame.com" },
  { en: "Moonkin Form", zh: "枭兽形态", source: "ol.3dmgame.com" },
  { en: "Innervate", zh: "激活", source: "ol.3dmgame.com" },
  { en: "Tranquility", zh: "宁静", source: "ol.3dmgame.com" },
  { en: "Ironbark", zh: "铁木树皮", source: "ol.3dmgame.com" },
  { en: "Skull Bash", zh: "迎头痛击", source: "ol.3dmgame.com" },
  { en: "Solar Beam", zh: "日光术", source: "ol.3dmgame.com" },
  { en: "Wrath", zh: "愤怒", source: "ol.3dmgame.com" },
  { en: "Starfire", zh: "星火术", source: "ol.3dmgame.com" },
  { en: "Moonfire", zh: "月火术", source: "ol.3dmgame.com" },
  { en: "Sunfire", zh: "阳炎术", source: "ol.3dmgame.com" },
  { en: "Starsurge", zh: "星涌术", source: "ol.3dmgame.com" },
  { en: "Shred", zh: "撕碎", source: "ol.3dmgame.com" },
  { en: "Rake", zh: "斜掠", source: "ol.3dmgame.com" },
  { en: "Rip", zh: "割裂", source: "ol.3dmgame.com" },
  { en: "Ferocious Bite", zh: "凶猛撕咬", source: "ol.3dmgame.com" },
  { en: "Mangle", zh: "裂伤", source: "ol.3dmgame.com" },

  // ── 恶魔猎手 Demon Hunter ──
  { en: "Metamorphosis", zh: "恶魔变形", source: "ol.3dmgame.com" },
  { en: "The Hunt", zh: "恶魔追击", source: "cn.wowhead.com 技能页" },
  { en: "Blade Dance", zh: "刃舞", source: "ol.3dmgame.com" },
  { en: "Immolation Aura", zh: "献祭光环", source: "ol.3dmgame.com" },
  { en: "Netherwalk", zh: "虚空行走", source: "ol.3dmgame.com" },
  { en: "Darkness", zh: "黑暗", source: "ol.3dmgame.com" },
  { en: "Fel Devastation", zh: "邪能毁灭", source: "ol.3dmgame.com" },
  { en: "Fiery Brand", zh: "烈火烙印", source: "ol.3dmgame.com" },
  { en: "Disrupt", zh: "瓦解", source: "ol.3dmgame.com" },
  { en: "Chaos Strike", zh: "混乱打击", source: "cn.wowhead.com 技能页" },
  { en: "Demon's Bite", zh: "恶魔之咬", source: "ol.3dmgame.com" },
  { en: "Eye Beam", zh: "眼棱", source: "ol.3dmgame.com" },
  { en: "Fel Rush", zh: "邪能冲撞", source: "ol.3dmgame.com" },
  { en: "Throw Glaive", zh: "投掷利刃", source: "ol.3dmgame.com" },
  { en: "Death Sweep", zh: "死亡横扫", source: "ol.3dmgame.com" },

  // ── 唤魔师 Evoker ──
  { en: "Dragonrage", zh: "狂龙之怒", source: "ol.3dmgame.com" },
  { en: "Tip the Scales", zh: "扭转天平", source: "ol.3dmgame.com" },
  { en: "Breath of Eons", zh: "亘古吐息", source: "cn.wowhead.com 技能页" },
  { en: "Obsidian Scales", zh: "黑曜鳞片", source: "ol.3dmgame.com" },
  { en: "Renewing Blaze", zh: "新生光焰", source: "ol.3dmgame.com" },
  { en: "Zephyr", zh: "微风", source: "ol.3dmgame.com" },
  { en: "Deep Breath", zh: "深呼吸", source: "ol.3dmgame.com" },
  { en: "Ebon Might", zh: "黑檀之力", source: "cn.wowhead.com 技能页" },
  { en: "Quell", zh: "镇压", source: "ol.3dmgame.com" },
  { en: "Living Flame", zh: "活化烈焰", source: "ol.3dmgame.com" },
  { en: "Disintegrate", zh: "裂解", source: "cn.wowhead.com 技能页" },
  { en: "Fire Breath", zh: "火焰吐息", source: "ol.3dmgame.com" },
  { en: "Azure Strike", zh: "碧蓝打击", source: "ol.3dmgame.com" },
  { en: "Pyre", zh: "葬火", source: "ol.3dmgame.com" },
];

const ALL_ENTRIES: AbilityNameEntry[] = [
  ...POTION_ENTRIES,
  ...ABILITY_ENTRIES,
  ...EFFECT_ENTRIES,
];

/** 归一化键：小写 + 去除空格/连字符/下划线/撇号/逗号/冒号，兼容 WCL 与多套写法。 */
function normalizeKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s\-_',:.]/g, "");
}

const ENTRY_MAP: Record<string, AbilityNameEntry> = {};
for (const e of ALL_ENTRIES) ENTRY_MAP[normalizeKey(e.en)] = e;

// 文本替换按英文名长度降序：先替换长名，避免短名抢先截断长名（如 "Rising Sun Kick"
// 内嵌 "Kick"、"Potion of Recklessness" 内嵌 "Recklessness"）。
const SORTED_BY_LEN_DESC = [...ALL_ENTRIES].sort((a, b) => b.en.length - a.en.length);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 单次遍历的组合正则（最长优先交替）：同一位置只匹配最长的英文名，避免内嵌短名
// 被重复/嵌套替换（如 "Rising Sun Kick" 不会被内部的 "Kick" 再替换一次）。
const COMBINED_RE = new RegExp(
  SORTED_BY_LEN_DESC.map((e) => escapeRegExp(e.en)).join("|"),
  "gi",
);

/** 单个英文专有名词 → "国服译名（英文原名）"；未收录原样返回英文（不报错、不改历史行为）。 */
export function translateAbilityName(englishName: string): string {
  const e = ENTRY_MAP[normalizeKey(englishName)];
  return e ? `${e.zh}（${e.en}）` : englishName;
}

/**
 * 将报告正文/问答回答中的英文技能/药水/增益名替换为"国服译名（英文原名）"
 * （大小写不敏感，未收录的原样保留英文）。
 */
export function localizeAbilityNames(text: string): string {
  if (!text) return text;
  return text.replace(COMBINED_RE, (match) => {
    const e = ENTRY_MAP[normalizeKey(match)];
    return e ? `${e.zh}（${e.en}）` : match;
  });
}
