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
