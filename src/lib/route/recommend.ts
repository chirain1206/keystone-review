import type { RouteFingerprint } from "@/lib/route/fingerprint";
import { routeSimilarity } from "@/lib/route/fingerprint";
import type { CompProfile } from "@/lib/route/comp-profile";
import { compSimilarity } from "@/lib/route/comp-profile";

/**
 * T23 参考目标推荐（FR-12 落地）。
 * 用户粘贴对比链接后，展示候选 log 与用户 log 的"路线相似度 + 阵容相似度"参考排序。
 * 数据不可用（无路线/阵容数据）时优雅降级：combined 与 note 为 null，不阻塞复盘。
 * 说明：WCL 适配器当前仅返回元数据（无事件流/阵容），故对比链路天然降级；
 * 本模块与 T20 挖掘工具（本地原始 log 可算路线/阵容）共用同一套纯函数。
 */

export interface ReferenceProfile {
  id: string;
  dungeon: string;
  level?: number;
  route?: RouteFingerprint;
  comp?: CompProfile;
}

export interface ReferenceComparison {
  id: string;
  routeSimilarity: number | null;
  compSimilarity: number | null;
  /** 可用维度相似度的均值；无任何可用维度时为 null（降级） */
  combined: number | null;
  /** 可读参考信息（如"路线相似度 0.85，阵容相似度 0.80"）；无数据时为 null */
  note: string | null;
}

export function compareReference(
  user: ReferenceProfile,
  candidate: ReferenceProfile,
): ReferenceComparison {
  const route = user.route && candidate.route ? routeSimilarity(user.route, candidate.route) : null;
  const comp = user.comp && candidate.comp ? compSimilarity(user.comp, candidate.comp) : null;
  const parts = [route, comp].filter((x): x is number => x !== null);
  const combined = parts.length > 0 ? parts.reduce((s, x) => s + x, 0) / parts.length : null;
  const note = parts.length === 0 ? null : formatNote(route, comp);
  return { id: candidate.id, routeSimilarity: route, compSimilarity: comp, combined, note };
}

/** 候选参考排序：按综合相似度降序，无数据者排最后（降级不阻塞）。 */
export function rankReferences(
  user: ReferenceProfile,
  candidates: ReferenceProfile[],
): ReferenceComparison[] {
  return candidates
    .map((c) => compareReference(user, c))
    .sort((x, y) => (y.combined ?? -1) - (x.combined ?? -1));
}

function formatNote(route: number | null, comp: number | null): string {
  const seg: string[] = [];
  if (route !== null) seg.push(`路线相似度 ${route.toFixed(2)}`);
  if (comp !== null) seg.push(`阵容相似度 ${comp.toFixed(2)}`);
  return seg.join("，");
}
