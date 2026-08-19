/**
 * 自动对比推荐的前端纯展示工具（无网络依赖，便于单测）。
 * 供 HomeUpload 的"选择对比目标"步骤渲染推荐列表：Key %（该专精玩家表现）、
 * 相似度百分比、时长、战斗日期、WCL 链接，以及"Key % 优先，相似度其次"的排序。
 */

import type { Lang } from "@/lib/i18n";

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * 战斗日期文案（随界面语言切换）：
 *  - 时间未知 → "—"；
 *  - 当天 → "今天" / "Today"；昨天 → "昨天" / "Yesterday"；
 *  - 7 天内 → "N 天前" / "N days ago"；
 *  - 更早 → 绝对日期 "M 月 D 日" / "MMM D"（用本地时区）。
 */
export function formatFightDate(ms: number | null, nowMs: number, lang: Lang = "zh"): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor((nowMs - ms) / dayMs);
  if (days <= 0) return lang === "en" ? "Today" : "今天";
  if (days === 1) return lang === "en" ? "Yesterday" : "昨天";
  if (days < 7) return lang === "en" ? `${days} days ago` : `${days} 天前`;
  const d = new Date(ms);
  return lang === "en" ? `${EN_MONTHS[d.getMonth()]} ${d.getDate()}` : `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** 相似度 0–1 → 百分比文案；null → "—"。 */
export function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

/** 路线相似度文案：null → "路线暂无"（区分于阵容相似度的 "—"）。 */
export function formatRouteSimilarity(value: number | null): string {
  return value === null || Number.isNaN(value) ? "路线暂无" : `${Math.round(value * 100)}%`;
}

/** 时长（秒）→ "27 分 30 秒"。 */
export function formatDurationSec(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m} 分 ${s % 60} 秒`;
}

/** 数值缩写：>=1000 → "8.5k" / "12.3k"。 */
function abbreviate(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** 排行指标值 → "DPS 12.3k"；null → "—"。 */
export function formatAmount(amount: number | null, metricName?: string | null): string {
  if (amount === null || Number.isNaN(amount)) return "—";
  const label = (metricName ?? "dps").toUpperCase();
  return `${label} ${abbreviate(amount)}`;
}

/** Key % → "Key % 88"；null/0（未计算）→ "Key % —"。 */
export function formatKeyPercent(value: number | null): string {
  if (value === null || Number.isNaN(value) || value <= 0) return "Key % —";
  return `Key % ${Math.round(value)}`;
}

/**
 * 该专精玩家表现："Key % 88 · DPS 12.3k"（有数据时拼接）；
 * Key % 缺失时回退 "DPS 12.3k"；全无 → "—"。
 */
export function formatPerformance(
  keyPercent: number | null,
  amount: number | null,
  metricName?: string | null,
): string {
  const parts: string[] = [];
  const k = formatKeyPercent(keyPercent);
  if (k !== "Key % —") parts.push(k);
  const a = formatAmount(amount, metricName);
  if (a !== "—") parts.push(a);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export interface RecommendationLike {
  keyPercent: number | null;
  amount: number | null;
  routeSimilarity: number | null;
  compSimilarity: number | null;
  combined: number | null;
}

/**
 * 表现列（压缩两段式）：Key % 突出显示 + DPS 小字灰显；无 Key % 时只显 DPS。
 * 返回结构化字段供组件分样式渲染（Key % 高亮、次要信息灰显、纯 DPS 兜底）。
 */
export interface PerformanceCell {
  /** 突出显示的 Key %（如 "Key % 88"）；无 Key % 时为 null。 */
  key: string | null;
  /** Key % 存在时的次要信息（"DPS 12.3k"，小字灰显）；无 Key % 或全无数据时为 null。 */
  secondary: string | null;
  /** 无 Key % 时的 DPS 兜底（正常字号）；有 Key % 或全无数据时为 null。 */
  dps: string | null;
}

/** 表现列压缩格式化（纯函数，便于单测）。 */
export function buildPerformanceCell(
  keyPercent: number | null,
  amount: number | null,
  metricName?: string | null,
): PerformanceCell {
  const hasKey = keyPercent !== null && !Number.isNaN(keyPercent) && keyPercent > 0;
  if (hasKey) {
    const a = formatAmount(amount, metricName);
    return {
      key: `Key % ${Math.round(keyPercent)}`,
      secondary: a === "—" ? null : a,
      dps: null,
    };
  }
  const a = formatAmount(amount, metricName);
  return { key: null, secondary: null, dps: a === "—" ? null : a };
}

/** 推荐行展示字段（"行渲染"纯函数输出，供组件直接渲染）。 */
export interface RecommendationRow {
  /** 层数文案（如 "10"）；缺失 → "—"。 */
  level: string;
  /** 该专精表现（Key % 突出 + DPS 灰显 / 纯 DPS 兜底）。 */
  performance: PerformanceCell;
  /** 阵容相似度文案（如 "87%"；缺失 → "—"）。 */
  comp: string;
  /** 路线相似度文案（如 "60%"；缺失 → "路线暂无"）。 */
  route: string;
  /** 时长文案（如 "27 分 30 秒"）。 */
  duration: string;
  /** 战斗日期文案（如 "3 天前" / "8 月 15 日" / "Aug 15"；时间未知 → "—"）。 */
  date: string;
  /** 是否限时。 */
  success: boolean;
  /** true = 较早候选（14–30 天），需标注"较早（注意职业改动）"。 */
  stale: boolean;
}

/** 推荐行输入的极简形状（与 HomeUpload 的 Recommendation 一致，仅取渲染所需字段）。 */
export interface RecommendationRowInput {
  level: number | null;
  keyPercent: number | null;
  amount: number | null;
  metricName: string | null;
  compSimilarity: number | null;
  routeSimilarity: number | null;
  durationSec: number;
  success: boolean;
  fightStartTimeMs: number | null;
  stale: boolean;
}

/** 单行渲染纯函数（层数 | 表现 | 阵容相似 | 路线相似 | 时长 | 日期 | 限时）。 */
export function buildRecommendationRow(
  input: RecommendationRowInput,
  opts: { lang?: Lang; nowMs?: number } = {},
): RecommendationRow {
  const lang = opts.lang ?? "zh";
  const nowMs = opts.nowMs ?? Date.now();
  return {
    level: input.level !== null && input.level !== undefined ? String(input.level) : "—",
    performance: buildPerformanceCell(input.keyPercent, input.amount, input.metricName),
    comp: formatPercent(input.compSimilarity),
    route: formatRouteSimilarity(input.routeSimilarity),
    duration: formatDurationSec(input.durationSec),
    date: formatFightDate(input.fightStartTimeMs, nowMs, lang),
    success: input.success,
    stale: input.stale,
  };
}

/**
 * 层数范围文案（目标摘要用）：去重升序后 "10–11"；单层 "10"；空 → "—"。
 */
export function buildLevelRange(levels: readonly (number | null)[]): string {
  const nums = [...new Set(levels.filter((l): l is number => l !== null && l !== undefined && Number.isFinite(l)))]
    .sort((a, b) => a - b);
  if (nums.length === 0) return "—";
  if (nums.length === 1) return String(nums[0]);
  return `${nums[0]}–${nums[nums.length - 1]}`;
}

/**
 * 推荐列表排序（与后端 rankRecommendations 一致）：Key % 优先，相似度其次。
 * 主排序 = Key % 降序（缺失排最后，缺失时 DPS 兜底）；次排序 = 路线相似度；再次 = 阵容相似度。
 */
export function sortRecommendations<T extends RecommendationLike>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const ka = a.keyPercent ?? -1;
    const kb = b.keyPercent ?? -1;
    if (ka !== kb) return kb - ka;
    const aa = a.amount ?? -1;
    const ab = b.amount ?? -1;
    if (aa !== ab) return ab - aa;
    const ra = a.routeSimilarity ?? -1;
    const rb = b.routeSimilarity ?? -1;
    if (ra !== rb) return rb - ra;
    return (b.compSimilarity ?? -1) - (a.compSimilarity ?? -1);
  });
}
