/**
 * 大秘境副本名中英映射（国服语境）。
 *
 * WCL 返回英文副本名（如 "Algeth'ar Academy"），国服用户对不上。本模块提供
 * "国服官方译名 + 英文原名括号"的显示形式，仅用于展示层（报告页 / 战斗列表 /
 * 分享页 / 历史列表）；**存储层与 AI 提示词仍保留游戏内英文原名**（见 PRD
 * "技能/副本名保留游戏内原名"），不做翻译。
 *
 * 译名核实来源（国服官方 / 中文社区维基）：
 *  - 至暗之夜第 1 赛季（12.0）8 本：暴雪官方新闻「New Challenges are Ahead in the
 *    Dungeons of Midnight」+ Icy Veins 赛季轮换（英文），国服译名对照暴雪官网
 *    worldofwarcraft.blizzard.com/zh-cn 地下城成就页 + 17173 官方资讯
 *  - 至暗之夜第 2 赛季（12.1）8 本：暴雪国服官网新闻 24294369 + method.gg
 *  - 地心之战第 1 赛季、巨龙时代、暗影国度：灰机wiki / 百度百科 / wowhead 中文站
 *
 * 语言切换（zh/en，见 src/lib/i18n.ts）：展示层按全局 lang 输出纯中文或纯英文；
 * 存储层与 AI 提示词仍保留游戏内英文原名，不受语言切换影响。
 */

import type { Lang } from "@/lib/i18n";

const DUNGEON_NAME_ZH: Record<string, string> = {
  // ── 至暗之夜（Midnight）第 2 赛季（12.1，当前轮换）──
  "Altar of Fangs": "毒牙祭坛",
  "Den of Nalorakk": "纳洛拉克的洞穴",
  "Murder Row": "密谋小径",
  "The Blinding Vale": "夺目谷",
  "Voidscar Arena": "虚空之痕竞技场",
  "King's Rest": "诸王之眠",
  "Kings' Rest": "诸王之眠", // WCL 实际拼写（撇号在 s 后），与 "King's Rest" 同归一化
  "Temple of Sethraliss": "塞塔里斯神庙",
  "Ruby Life Pools": "红玉新生法池",

  // ── 至暗之夜（Midnight）第 1 赛季（12.0）──
  "Magister's Terrace": "魔导师平台",
  "Maisara Caverns": "迈萨拉洞窟",
  "Nexus-Point Xenas": "节点希纳斯",
  "Windrunner Spire": "风行者之塔",

  // ── 地心之战（The War Within）第 1 赛季 ──
  "The Stonevault": "矶石宝库",
  "Ara-Kara, City of Echoes": "艾拉-卡拉，回响之城",
  "City of Threads": "千丝之城",
  "The Dawnbreaker": "破晨号",
  "Grim Batol": "格瑞姆巴托",
  "Mists of Tirna Scithe": "塞兹仙林的迷雾",
  "Siege of Boralus": "伯拉勒斯围攻",
  "The Necrotic Wake": "凋魂之殇",

  // ── 巨龙时代（Dragonflight）大秘境轮换 ──
  "Algeth'ar Academy": "艾杰斯亚学院",
  "The Azure Vault": "碧蓝魔馆",
  "The Nokhud Offensive": "诺库德阻击战",
  "Halls of Infusion": "注能大厅",
  "Brackenhide Hollow": "蕨皮山谷",
  "Uldaman: Legacy of Tyr": "奥达曼：提尔的遗产",
  "Neltharus": "奈萨鲁斯",
  "Dawn of the Infinite": "永恒黎明",
  "The Vortex Pinnacle": "漩涡尖塔",

  // ── 暗影国度（Shadowlands）大秘境轮换 ──
  "Plaguefall": "瘟疫之临",
  "Halls of Atonement": "赎罪大厅",
  "Theater of Pain": "伤逝剧场",
  "De Other Side": "彼界",
  "Spires of Ascension": "晋升高塔",
  "Sanguine Depths": "赤红深渊",
  "Tazavesh, the Veiled Market": "塔扎维什，帷纱集市",

  // ── 争霸艾泽拉斯（Battle for Azeroth）常见大秘境 ──
  "Freehold": "自由镇",
  "Atal'Dazar": "阿塔达萨",
  "Tol Dagor": "托尔达戈",
  "Shrine of the Storm": "风暴神殿",
  "Waycrest Manor": "韦克雷斯特庄园",
  "The Underrot": "幽腐深坑",

  // ── 军团再临（Legion）常见大秘境 ──
  "Eye of Azshara": "艾萨拉之眼",
  "Neltharion's Lair": "奈萨里奥的巢穴",
  "Vault of the Wardens": "守望者的地窟",
  "Maw of Souls": "噬魂之喉",
  "Halls of Valor": "英灵殿",
  "Black Rook Hold": "黑鸦堡垒",
  "Court of Stars": "群星庭院",
  "Darkheart Thicket": "暗心林地",
  "The Arcway": "魔法回廊",
  "Cathedral of Eternal Night": "永夜大教堂",
  "Seat of the Triumvirate": "执政团之座",

  // ── 巫妖王之怒（Wrath of the Lich King）常见大秘境 ──
  "Pit of Saron": "萨隆矿坑",

  // ── 大灾变（Cataclysm）常见大秘境 ──
  "The Stonecore": "石岩之心",

  // ── 德拉诺之王（Warlords of Draenor）常见大秘境 ──
  // 通天峰：cn.wowhead.com zone=6988（"通天峰"）与成就页 achievement=8843 核实
  "Skyreach": "通天峰",
};

/**
 * 归一化键：小写 + 去除撇号/双引号 + 连字符转空格 + 折叠空白。
 * 容忍 WCL 拼写差异：
 *  - 撇号位置："Kings' Rest" vs "King's Rest"（撇号整体去除后同为 "kings rest"）；
 *  - 弯/直引号："King’s Rest" vs "King's Rest"；
 *  - 连字符："Nexus-Point Xenas" vs "Nexus Point Xenas"；
 *  - 大小写："algeth'ar academy" vs "Algeth'ar Academy"。
 */
function normalizeKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[\u201c\u201d"]/g, "")
    .replace(/[\u2013\u2014-]/g, " ")
    .replace(/\s+/g, " ");
}

const NORMALIZED_ZH: Record<string, string> = Object.fromEntries(
  Object.entries(DUNGEON_NAME_ZH).map(([en, zh]) => [normalizeKey(en), zh]),
);

/**
 * 归一化键 → 规范英文原名（en 模式输出用，顺带归一化 WCL 拼写差异）。
 * 注意"首次命中优先"：重复归一化键（如 "King's Rest" 与变体 "Kings' Rest"）保留
 * 先出现的规范拼写，保证 en 模式输出 "King's Rest" 而非变体拼写。
 */
const NORMALIZED_EN: Record<string, string> = {};
for (const en of Object.keys(DUNGEON_NAME_ZH)) {
  const key = normalizeKey(en);
  if (!(key in NORMALIZED_EN)) NORMALIZED_EN[key] = en;
}

/** 返回英文副本名对应的国服官方译名；查无则返回 null。 */
export function translateDungeonName(english: string): string | null {
  return NORMALIZED_ZH[normalizeKey(english)] ?? null;
}

/** 返回英文副本名对应的规范英文原名（en 模式用）；查无则返回 null。 */
export function canonicalDungeonName(english: string): string | null {
  return NORMALIZED_EN[normalizeKey(english)] ?? null;
}

/**
 * 展示用副本名（随界面语言切换）：
 *  - zh（默认）：国服官方纯中文译名（如 "毒牙祭坛"）；未收录 → 原英文名；
 *  - en：规范英文原名（如 "Altar of Fangs"，并归一化 "Kings' Rest"→"King's Rest"）；
 *    未收录 → 原样返回。
 */
export function dungeonDisplayName(english: string, lang: Lang = "zh"): string {
  if (lang === "en") return canonicalDungeonName(english) ?? english;
  return translateDungeonName(english) ?? english;
}
