/**
 * 职业 / 专精名中英映射（国服语境）。
 *
 * WCL 返回英文职业名（如 "DeathKnight"、"DemonHunter"，无空格驼峰）与专精名
 * （如 "Unholy"、"Beast Mastery"），国服用户对不上。本模块提供
 * "国服官方译名 + 英文原名括号"的显示形式，仅用于展示层（玩家列表 / 报告页
 * header / 分享页 / 历史列表）；**存储层与 AI 提示词仍保留游戏内英文原名**
 * （见 PRD "技能/副本名保留游戏内原名"），不做翻译。
 *
 * 职业名存在两套写法（需同时兼容）：
 *  - WCL v2 GraphQL：subType 返回无空格驼峰（"DeathKnight"、"DemonHunter"）；
 *  - 本地 WoWCombatLog 解析器（src/lib/parser/format.ts CLASS_NAMES）：带空格
 *    （"Death Knight"、"Demon Hunter"）。
 * 专精名同理（"Beast Mastery" / "BeastMastery"）。归一化键统一去除空格/连字符/
 * 下划线/撇号后小写，两套写法均命中同一译名。
 *
 * 译名核实来源（国服官方简体中文，逐条对照）：
 *  - 职业名：暴雪中国官网职业页 worldofwarcraft.blizzard.com/zh-cn/game/classes/*
 *    （战士/圣骑士/猎人/潜行者/牧师/死亡骑士/萨满祭司/法师/术士/武僧/德鲁伊/
 *    恶魔猎手/唤魔师）；潜行者 = 国服官方现名（原"盗贼"）；萨满祭司 = 官方全名。
 *  - 专精名：cn.wowhead.com 各职业专精页 + 灰机wiki（warcraft.huijiwiki.com）+
 *    百度百科；唤魔师三专精"湮灭/恩护/增辉"以 wowhead cn 任务页
 *    "恩护，增辉或湮灭"与灰机wiki 为准（Preservation = 恩护，非"保护"）；
 *    恶魔猎手第三专精"吞噬者"（Devourer）为至暗之夜 12.0 前夕新增，以国服官方
 *    专精名"吞噬者"核实（17173/网易官方转载 + 暴雪官方蓝贴）。
 */

interface NameEntry {
  /** 规范英文原名（游戏内写法，带空格，如 "Death Knight"、"Beast Mastery"）。 */
  en: string;
  /** 国服官方简体中文译名。 */
  zh: string;
}

/** 13 职业（国服官方简体中文名）。 */
const CLASS_ENTRIES: NameEntry[] = [
  { en: "Warrior", zh: "战士" },
  { en: "Paladin", zh: "圣骑士" },
  { en: "Hunter", zh: "猎人" },
  { en: "Rogue", zh: "潜行者" }, // 国服官方现名（旧译"盗贼"）
  { en: "Priest", zh: "牧师" },
  { en: "Death Knight", zh: "死亡骑士" },
  { en: "Shaman", zh: "萨满祭司" }, // 官方全名
  { en: "Mage", zh: "法师" },
  { en: "Warlock", zh: "术士" },
  { en: "Monk", zh: "武僧" },
  { en: "Druid", zh: "德鲁伊" },
  { en: "Demon Hunter", zh: "恶魔猎手" },
  { en: "Evoker", zh: "唤魔师" },
];

/** 全部专精（当前版本 40 个 + 常见历史专精 2 个）。 */
const SPEC_ENTRIES: NameEntry[] = [
  // 战士
  { en: "Arms", zh: "武器" },
  { en: "Fury", zh: "狂暴" },
  { en: "Protection", zh: "防护" },
  // 圣骑士
  { en: "Holy", zh: "神圣" },
  { en: "Protection", zh: "防护" },
  { en: "Retribution", zh: "惩戒" },
  // 猎人
  { en: "Beast Mastery", zh: "野兽控制" },
  { en: "Marksmanship", zh: "射击" },
  { en: "Survival", zh: "生存" },
  // 潜行者
  { en: "Assassination", zh: "刺杀" },
  { en: "Outlaw", zh: "狂徒" },
  { en: "Subtlety", zh: "敏锐" },
  // 牧师
  { en: "Discipline", zh: "戒律" },
  { en: "Holy", zh: "神圣" },
  { en: "Shadow", zh: "暗影" },
  // 死亡骑士
  { en: "Blood", zh: "鲜血" },
  { en: "Frost", zh: "冰霜" },
  { en: "Unholy", zh: "邪恶" },
  // 萨满祭司
  { en: "Elemental", zh: "元素" },
  { en: "Enhancement", zh: "增强" },
  { en: "Restoration", zh: "恢复" },
  // 法师
  { en: "Arcane", zh: "奥术" },
  { en: "Fire", zh: "火焰" },
  { en: "Frost", zh: "冰霜" },
  // 术士
  { en: "Affliction", zh: "痛苦" },
  { en: "Demonology", zh: "恶魔学识" },
  { en: "Destruction", zh: "毁灭" },
  // 武僧
  { en: "Brewmaster", zh: "酒仙" },
  { en: "Mistweaver", zh: "织雾" },
  { en: "Windwalker", zh: "踏风" },
  // 德鲁伊
  { en: "Balance", zh: "平衡" },
  { en: "Feral", zh: "野性" },
  { en: "Guardian", zh: "守护" },
  { en: "Restoration", zh: "恢复" },
  // 恶魔猎手
  { en: "Havoc", zh: "浩劫" },
  { en: "Vengeance", zh: "复仇" },
  { en: "Devourer", zh: "吞噬者" }, // 至暗之夜 12.0 前夕新增第三专精
  // 唤魔师
  { en: "Devastation", zh: "湮灭" },
  { en: "Preservation", zh: "恩护" }, // 官方译名"恩护"，非"保护"
  { en: "Augmentation", zh: "增辉" },
  // ── 常见历史专精（已移除，兼容旧报告/旧 WCL 数据）──
  { en: "Combat", zh: "战斗" }, // 潜行者旧专精（7.0 改为 Outlaw 狂徒）
  { en: "Feral Combat", zh: "野性战斗" }, // 德鲁伊旧野性系（MoP 拆分 Feral/Guardian）
];

/** 归一化键：小写 + 去除空格/连字符/下划线/撇号，两套写法均命中。 */
function normalizeKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s\-_']/g, "");
}

function index(entries: NameEntry[]): Record<string, NameEntry> {
  const map: Record<string, NameEntry> = {};
  for (const e of entries) map[normalizeKey(e.en)] = e;
  return map;
}

const CLASS_MAP = index(CLASS_ENTRIES);
const SPEC_MAP = index(SPEC_ENTRIES);

/** 返回英文职业名对应的国服官方译名；查无则返回 null。 */
export function translateClassName(english: string): string | null {
  return CLASS_MAP[normalizeKey(english)]?.zh ?? null;
}

/** 展示用职业名：国服译名 + 英文原名括号（如 "死亡骑士（Death Knight）"）；未收录原样返回。 */
export function classDisplayName(english: string): string {
  const e = CLASS_MAP[normalizeKey(english)];
  return e ? `${e.zh}（${e.en}）` : english;
}

/** 返回英文专精名对应的国服官方译名；查无则返回 null。 */
export function translateSpecName(english: string): string | null {
  return SPEC_MAP[normalizeKey(english)]?.zh ?? null;
}

/** 展示用专精名：国服译名 + 英文原名括号（如 "邪恶（Unholy）"）；未收录原样返回。 */
export function specDisplayName(english: string): string {
  const e = SPEC_MAP[normalizeKey(english)];
  return e ? `${e.zh}（${e.en}）` : english;
}

/**
 * 展示用"职业 + 专精"组合（报告页 header / 分享页徽章）：
 * "死亡骑士（Death Knight） 邪恶（Unholy）"；"Unknown" 或空值跳过对应项，
 * 二者均未知时回退为原英文 class（不报错）。
 */
export function classSpecDisplayName(cls: string, spec: string): string {
  const parts: string[] = [];
  if (cls && cls !== "Unknown") parts.push(classDisplayName(cls));
  if (spec && spec !== "Unknown") parts.push(specDisplayName(spec));
  return parts.length > 0 ? parts.join(" ") : cls || "职业未知";
}
