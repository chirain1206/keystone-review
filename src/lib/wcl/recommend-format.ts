/**
 * 自动对比推荐的前端纯展示工具（无网络依赖，便于单测）。
 * 供 HomeUpload 的"选择对比目标"步骤渲染推荐列表：该专精玩家表现（DPS/score）、
 * 相似度百分比、时长，以及"表现优先，相似度其次"的排序。
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

/** 排行指标值 → "DPS 12.3k"；null → "—"；metricName 缺省按 dps 展示单位。 */
export function formatAmount(amount: number | null, metricName?: string | null): string {
  if (amount === null || Number.isNaN(amount)) return "—";
  const label = (metricName ?? "dps").toUpperCase();
  return `${label} ${abbreviate(amount)}`;
}

/** M+ score → "335 分"；null → null（不显示）。 */
function formatScore(score: number | null): string | null {
  if (score === null || Number.isNaN(score)) return null;
  return `${Math.round(score)} 分`;
}

/**
 * 该专精玩家表现："DPS 12.3k · 335 分"（有 score 时）；无任何数据 → "—"。
 * 说明：M+ DPS 榜（characterRankings metric=dps）无 parse 分位，只有原始 DPS + M+ score。
 */
export function formatPerformance(
  amount: number | null,
  metricName?: string | null,
  score?: number | null,
): string {
  const parts: string[] = [];
  const a = formatAmount(amount, metricName);
  if (a !== "—") parts.push(a);
  const s = formatScore(score ?? null);
  if (s) parts.push(s);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export interface RecommendationLike {
  amount: number | null;
  routeSimilarity: number | null;
  compSimilarity: number | null;
  combined: number | null;
}

/**
 * 推荐列表排序（与后端 rankRecommendations 一致）：表现优先，相似度其次。
 * 主排序 = 该专精玩家 DPS（amount）降序（null 排最后）；次排序 = 路线相似度降序；再次 = 阵容相似度降序。
 * 纯函数，返回新数组，不改动入参。
 */
export function sortRecommendations<T extends RecommendationLike>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const aa = a.amount ?? -1;
    const ab = b.amount ?? -1;
    if (aa !== ab) return ab - aa;
    const ra = a.routeSimilarity ?? -1;
    const rb = b.routeSimilarity ?? -1;
    if (ra !== rb) return rb - ra;
    return (b.compSimilarity ?? -1) - (a.compSimilarity ?? -1);
  });
}
