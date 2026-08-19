/**
 * 自动对比推荐的前端纯展示工具（无网络依赖，便于单测）。
 * 供 HomeUpload 的"选择对比目标"步骤渲染推荐列表：相似度百分比、时长、排序。
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

export interface RecommendationLike {
  combined: number | null;
}

/**
 * 推荐列表排序：综合分降序，无综合分（null）排最后（降级不阻塞）。
 * 纯函数，返回新数组，不改动入参。
 */
export function sortByCombined<T extends RecommendationLike>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (b.combined ?? -1) - (a.combined ?? -1));
}
