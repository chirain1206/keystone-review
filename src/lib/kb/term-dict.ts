import { ABILITY_NAME_ENTRIES } from "@/lib/wcl/ability-zh-names";

/**
 * 术语词典（FR-11 增强）：把 ASR/OCR/简称/错字统一成"标准名"。
 *
 * 场景：视频转写、专家笔记里经常出现错字（集分梯、门户掌、乾元之鳞）与简称
 * （怒雷、旭日、神鹤）。这些非标准写法若直接入库，会导致检索命中率下降、术语
 * 混乱。本模块提供 { standard, aliases[] } 词典 + normalizeTerms 整词替换：
 *  - 标准名（standard）作为"标准词"，源自国服官方译名（ability-zh-names 的 zh
 *    字段）与武僧专精约定（monk-windwalker.md / user-notes-ocr.md 已入库术语）；
 *  - 别名（aliases）为错字/简称/英文原名，统一替换为标准名；
 *  - 长词优先防嵌套：一个别名的前缀若恰好是更短的别名（如"怒雷"是"怒雷破"的
 *    前缀），先匹配长词，避免"怒雷破"被改成"怒雷破破"。
 */

export interface TermEntry {
  /** 标准名（国服官方译名或专精约定写法）。 */
  standard: string;
  /** 别名：错字 / OCR/ASR 误写 / 简称 / 英文原名，统一替换为标准名。 */
  aliases: string[];
}

/**
 * 武僧专精术语（以 monk-windwalker.md 与 user-notes-ocr.md 出现的术语为准）。
 * 左侧标准名、右侧为常见错字/简称；英文原名由 ability-zh-names 自动补充。
 */
export const MONK_TERMS: TermEntry[] = [
  { standard: "疾风踢", aliases: ["集分梯"] },
  { standard: "猛虎掌", aliases: ["门户掌", "门户章"] },
  { standard: "众神聚心", aliases: ["众神巨像"] },
  { standard: "乾元之巅", aliases: ["乾元之鳞", "擎人之巅", "倾天之巅"] },
  { standard: "乾元镇踏", aliases: ["震踏", "乾元引踢"] },
  { standard: "怒雷破", aliases: ["怒雷"] },
  { standard: "神鹤引项踢", aliases: ["神鹤"] },
  { standard: "旭日东升踢", aliases: ["旭日"] },
  { standard: "升龙霸", aliases: ["升龙", "生霸", "生龙"] },
  { standard: "天神御身", aliases: ["天神玉身"] },
  { standard: "白虎下凡", aliases: ["白虎"] },
  { standard: "幻灭踢", aliases: ["幻灭"] },
  { standard: "赤精之舞", aliases: ["赤精"] },
];

/** 通用术语：嗜血（嗜血/英勇/血性狂怒 这类"群体急速增益"统一写作嗜血）。 */
export const GENERAL_TERMS: TermEntry[] = [
  { standard: "嗜血", aliases: ["英勇", "血性狂怒"] },
];

/** 显式人工纠错词典（首版）。 */
export const EXPLICIT_TERMS: TermEntry[] = [...MONK_TERMS, ...GENERAL_TERMS];

let cachedAllTerms: TermEntry[] | null = null;

/**
 * 合并后的完整词典：显式纠错词典 + ability-zh-names 的英文→中文标准名。
 * 合并规则（去冲突）：
 *  - 显式词典里的"别名"表示该词已非标准写法（如"英勇"→"嗜血"）；
 *  - 因此当 ability-zh-names 里某个 zh（如 Heroism→"英勇"）已被降级为别名时，
 *    其英文原名也一并归入该别名的标准（Heroism→"嗜血"），不另立"英勇"为标准。
 */
export function getAllTerms(): TermEntry[] {
  if (cachedAllTerms) return cachedAllTerms;

  const aliasToStandard = new Map<string, string>();
  for (const t of EXPLICIT_TERMS) {
    for (const a of t.aliases) aliasToStandard.set(a, t.standard);
  }
  for (const e of ABILITY_NAME_ENTRIES) {
    // 若 e.zh 已被显式词典降级为别名，则 en 归入同一标准；否则 en 作为 e.zh 的别名
    const standard = aliasToStandard.get(e.zh) ?? e.zh;
    aliasToStandard.set(e.en, standard);
  }

  const standardToAliases = new Map<string, string[]>();
  for (const [alias, standard] of aliasToStandard) {
    const list = standardToAliases.get(standard) ?? [];
    list.push(alias);
    standardToAliases.set(standard, list);
  }
  cachedAllTerms = [...standardToAliases.entries()].map(([standard, aliases]) => ({
    standard,
    aliases,
  }));
  return cachedAllTerms;
}

/** 仅测试用：重置合并词典缓存。 */
export function resetTermDictForTest(): void {
  cachedAllTerms = null;
}

export interface NormalizeOptions {
  /** 额外/覆盖词典项（测试注入或临时补充）。 */
  extraTerms?: TermEntry[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 按词典做整词替换，返回标准化文本。
 *  - 标准名以"自身→自身"身份进入匹配表，避免被更短的别名截断（防嵌套）；
 *  - 所有模式按长度降序排成单次交替正则，同位置优先命中最长模式；
 *  - 大小写不敏感（英文原名兼容大小写差异），中文不受影响。
 */
export function normalizeTerms(text: string, opts: NormalizeOptions = {}): string {
  if (!text) return text;
  const terms = [...getAllTerms(), ...(opts.extraTerms ?? [])];

  const replacement = new Map<string, string>();
  const addPattern = (pattern: string, to: string): void => {
    if (!pattern) return;
    const key = pattern.toLowerCase();
    if (!replacement.has(key)) replacement.set(key, to);
  };
  for (const t of terms) {
    addPattern(t.standard, t.standard); // 标准身份：防被短别名截断
    for (const a of t.aliases) addPattern(a, t.standard);
  }

  const sorted = [...replacement.entries()].sort((a, b) => b[0].length - a[0].length);
  if (sorted.length === 0) return text;

  const combined = new RegExp(sorted.map(([p]) => escapeRegExp(p)).join("|"), "gi");
  return text.replace(combined, (match) => replacement.get(match.toLowerCase()) ?? match);
}
