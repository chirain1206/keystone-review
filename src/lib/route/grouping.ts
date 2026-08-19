import type { RouteFingerprint } from "@/lib/route/fingerprint";
import { routeSimilarity, SAME_ROUTE_THRESHOLD } from "@/lib/route/fingerprint";

/**
 * T23 挖掘分组（FR-12 落地）：同路线（哪怕 WCL 波次不同）的 log 归同组一起挖掘。
 * 贪心聚类：以组内第一个成员的路线指纹为代表，相似度 ≥ 阈值判为同组。
 * 无路线数据的 log 各自独立成组（不丢弃数据源），由调用方决定是否跳过挖掘。
 */

export interface RouteProfileInput {
  id: string;
  route?: RouteFingerprint;
}

export interface RouteGroup {
  ids: string[];
  /** false = 无路线数据（独立组，无法按路线归并） */
  sameRoute: boolean;
}

export function groupByRoute(profiles: RouteProfileInput[]): RouteGroup[] {
  const groups: { rep: RouteFingerprint | null; ids: string[] }[] = [];
  for (const p of profiles) {
    if (!p.route) {
      groups.push({ rep: null, ids: [p.id] });
      continue;
    }
    const g = groups.find(
      (grp) => grp.rep !== null && routeSimilarity(grp.rep, p.route!) >= SAME_ROUTE_THRESHOLD,
    );
    if (g) g.ids.push(p.id);
    else groups.push({ rep: p.route, ids: [p.id] });
  }
  return groups.map((g) => ({ ids: g.ids, sameRoute: g.rep !== null }));
}
