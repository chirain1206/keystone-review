/**
 * 自动对比推荐的前端纯展示工具（无网络依赖，便于单测）。
 * 供 HomeUpload 的"选择对比目标"步骤渲染推荐列表：Key %（该专精玩家表现）、
 * 相似度百分比、时长、WCL 链接，以及"Key % 优先，相似度其次"的排序。
 */

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

/** Parse % → "Parse % 96"；null/0 → null（不展示）。 */
function formatParsePercent(value: number | null): string | null {
  if (value === null || Number.isNaN(value) || value <= 0) return null;
  return `Parse % ${Math.round(value)}`;
}

/**
 * 该专精玩家表现："Key % 88 · Parse % 96 · DPS 12.3k"（有数据时拼接）；
 * Key % 缺失时回退 "DPS 12.3k"；全无 → "—"。
 */
export function formatPerformance(
  keyPercent: number | null,
  parsePercent: number | null,
  amount: number | null,
  metricName?: string | null,
): string {
  const parts: string[] = [];
  const k = formatKeyPercent(keyPercent);
  if (k !== "Key % —") parts.push(k);
  const p = formatParsePercent(parsePercent);
  if (p) parts.push(p);
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
 * 表现列（压缩两段式）：Key % 突出显示 + Parse %/DPS 小字灰显；无 Key % 时只显 DPS。
 * 返回结构化字段供组件分样式渲染（Key % 高亮、次要信息灰显、纯 DPS 兜底）。
 */
export interface PerformanceCell {
  /** 突出显示的 Key %（如 "Key % 88"）；无 Key % 时为 null。 */
  key: string | null;
  /** Key % 存在时的次要信息（"Parse % 96 · DPS 12.3k"，小字灰显）；无 Key % 时为 null。 */
  secondary: string | null;
  /** 无 Key % 时的 DPS 兜底（正常字号）；有 Key % 或全无数据时为 null。 */
  dps: string | null;
}

/** 表现列压缩格式化（纯函数，便于单测）。 */
export function buildPerformanceCell(
  keyPercent: number | null,
  parsePercent: number | null,
  amount: number | null,
  metricName?: string | null,
): PerformanceCell {
  const hasKey = keyPercent !== null && !Number.isNaN(keyPercent) && keyPercent > 0;
  if (hasKey) {
    const parts: string[] = [];
    if (parsePercent !== null && !Number.isNaN(parsePercent) && parsePercent > 0) {
      parts.push(`Parse % ${Math.round(parsePercent)}`);
    }
    const a = formatAmount(amount, metricName);
    if (a !== "—") parts.push(a);
    return {
      key: `Key % ${Math.round(keyPercent)}`,
      secondary: parts.length > 0 ? parts.join(" · ") : null,
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
  /** 该专精表现（Key % 突出 + Parse %/DPS 灰显 / 纯 DPS 兜底）。 */
  performance: PerformanceCell;
  /** 阵容相似度文案（如 "87%"；缺失 → "—"）。 */
  comp: string;
  /** 路线相似度文案（如 "60%"；缺失 → "路线暂无"）。 */
  route: string;
  /** 时长文案（如 "27 分 30 秒"）。 */
  duration: string;
  /** 是否限时。 */
  success: boolean;
}

/** 推荐行输入的极简形状（与 HomeUpload 的 Recommendation 一致，仅取渲染所需字段）。 */
export interface RecommendationRowInput {
  level: number | null;
  keyPercent: number | null;
  parsePercent: number | null;
  amount: number | null;
  metricName: string | null;
  compSimilarity: number | null;
  routeSimilarity: number | null;
  durationSec: number;
  success: boolean;
}

/** 单行渲染纯函数（层数 | 表现 | 阵容相似 | 路线相似 | 时长 | 限时）。 */
export function buildRecommendationRow(input: RecommendationRowInput): RecommendationRow {
  return {
    level: input.level !== null && input.level !== undefined ? String(input.level) : "—",
    performance: buildPerformanceCell(
      input.keyPercent,
      input.parsePercent,
      input.amount,
      input.metricName,
    ),
    comp: formatPercent(input.compSimilarity),
    route: formatRouteSimilarity(input.routeSimilarity),
    duration: formatDurationSec(input.durationSec),
    success: input.success,
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
