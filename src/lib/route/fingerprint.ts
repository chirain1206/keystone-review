import type { TacticalRun } from "@/lib/parser/tactical-pulls";

/**
 * T22 路线指纹与相似度（FR-12 / ADR-003）。
 *
 * 路线指纹 = 波序列，每波 = 怪物签名（NPC 名 + 数量，模糊匹配容忍同类怪数量小差异）
 * + 相对时间锚（进本归一化 + boss 锚点计数）。
 *
 * 相似度 = 内容（怪物多重集重叠，容忍合波/拆波与数量差异）+ 顺序（压平后怪物名序列
 * 对齐，容忍合波方式差异与顺序小差异）的加权。压平序列天然对"合波方式差异"不敏感 ——
 * 同一批怪无论拆成一波还是合成一波，压平后的顺序一致。
 * 输出相似度 0–1 + 差异清单（多/少哪波、顺序差异、构成差异）。
 */

export interface NpcGroup {
  name: string;
  npcId: number | null;
  count: number;
}

export interface WaveSignature {
  npcs: NpcGroup[]; // 保持拉怪进入顺序
  kind: "trash" | "boss";
  /** 该波之前出现的 boss 波数（时间锚段序号） */
  bossAnchor: number;
  /** 相对进本的归一化时间 [0,1] */
  relTime: number;
}

export interface RouteFingerprint {
  dungeon: string;
  waves: WaveSignature[];
  trashWaves: WaveSignature[];
  bossCount: number;
}

/** 判定为"同路线"的相似度阈值（T23 分组 / FR-12 验收参考）。 */
export const SAME_ROUTE_THRESHOLD = 0.6;

/**
 * 单波同名怪展开上限（L-ROUTE-3）：flattenNames 按 n.count 逐个展开，
 * 恶意构造 log 可让单波同名怪 count 极大，从而把 LCS 的 O(n×m) 表放大到 OOM。
 * 对单个 NPC 组的展开数封顶，限制压平序列长度。
 */
export const MAX_NPC_EXPAND = 500;

export function buildRouteFingerprint(run: TacticalRun): RouteFingerprint {
  const waves: WaveSignature[] = [];
  let bossSeen = 0;
  const duration = Math.max(1, run.durationSec);

  for (const pull of run.pulls) {
    const npcMap = new Map<string, NpcGroup>();
    for (const npc of pull.npcs) {
      const g = npcMap.get(npc.name) ?? { name: npc.name, npcId: npc.npcId, count: 0 };
      g.count++;
      npcMap.set(npc.name, g);
    }
    // 保持拉怪进入顺序（不按名字排序）：顺序信息供压平序列对齐使用，
    // 多重集比较（内容相似度）与波级模糊匹配对顺序不敏感。
    const npcs = [...npcMap.values()];
    const relTime = pull.startSec / duration;
    waves.push({
      npcs,
      kind: pull.kind,
      bossAnchor: bossSeen,
      relTime: Math.min(1, Math.max(0, relTime)),
    });
    if (pull.kind === "boss") bossSeen++;
  }

  return {
    dungeon: run.dungeon,
    waves,
    trashWaves: waves.filter((w) => w.kind === "trash"),
    bossCount: bossSeen,
  };
}

/** 怪物名多重集（忽略波次边界）。 */
function npcMultiset(waves: WaveSignature[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of waves) {
    for (const n of w.npcs) m.set(n.name, (m.get(n.name) ?? 0) + n.count);
  }
  return m;
}

/** 多重集重叠（Jaccard 语义，容忍数量差异与合波/拆波）。 */
export function multisetOverlap(a: Map<string, number>, b: Map<string, number>): number {
  let inter = 0;
  let union = 0;
  for (const [k, ca] of a) {
    const cb = b.get(k) ?? 0;
    inter += Math.min(ca, cb);
    union += Math.max(ca, cb);
  }
  for (const [k, cb] of b) {
    if (!a.has(k)) union += cb;
  }
  if (union === 0) return inter === 0 ? 1 : 0;
  return inter / union;
}

function flattenNames(waves: WaveSignature[]): string[] {
  const out: string[] = [];
  for (const w of waves) {
    for (const n of w.npcs) {
      const cnt = Math.min(n.count, MAX_NPC_EXPAND);
      for (let i = 0; i < cnt; i++) out.push(n.name);
    }
  }
  return out;
}

function lcsLength(a: string[], b: string[]): number {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[n][m];
}

function sequenceSimilarity(a: string[], b: string[]): number {
  const total = a.length + b.length;
  if (total === 0) return 1;
  return (2 * lcsLength(a, b)) / total;
}

/**
 * 路线相似度 0–1：
 *  0.5 × 内容重叠（怪物多重集）+ 0.5 × 顺序相似（压平序列对齐）。
 * 同路线不同波次边界 / 合波方式差异 → 内容与压平顺序一致 → 高相似；
 * 不同路线（不同怪物集或大幅换序）→ 低相似。
 */
export function routeSimilarity(a: RouteFingerprint, b: RouteFingerprint): number {
  const content = multisetOverlap(npcMultiset(a.trashWaves), npcMultiset(b.trashWaves));
  const order = sequenceSimilarity(flattenNames(a.trashWaves), flattenNames(b.trashWaves));
  return 0.5 * content + 0.5 * order;
}

/** 单波怪物构成模糊匹配（多重集 Jaccard，容忍同类怪数量小差异）。 */
export function waveMatch(a: WaveSignature, b: WaveSignature): number {
  if (a.kind !== b.kind) return 0;
  const ma = new Map(a.npcs.map((n) => [n.name, n.count]));
  const mb = new Map(b.npcs.map((n) => [n.name, n.count]));
  let inter = 0;
  let union = 0;
  for (const [k, ca] of ma) {
    const cb = mb.get(k) ?? 0;
    inter += Math.min(ca, cb);
    union += Math.max(ca, cb);
  }
  for (const [k, cb] of mb) {
    if (!ma.has(k)) union += cb;
  }
  return union === 0 ? 1 : inter / union;
}

function describeWave(w: WaveSignature): string {
  return w.npcs.map((n) => `${n.name}×${n.count}`).join("、") || "（空）";
}

export interface RouteDiffEntry {
  kind: "extra-a" | "extra-b" | "composition" | "order";
  aWave?: number; // 1-based
  bWave?: number;
  detail: string;
}

export interface RouteDiff {
  similarity: number;
  contentSimilarity: number;
  orderSimilarity: number;
  entries: RouteDiffEntry[];
  summary: string;
}

interface Alignment {
  pairs: [number, number][];
  aOnly: number[];
  bOnly: number[];
}

/** 波级序列对齐（Needleman-Wunsch：模糊匹配奖励 + 缺口惩罚）。 */
function alignWaves(a: WaveSignature[], b: WaveSignature[], gapPenalty = 0.6): Alignment {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) dp[i][0] = dp[i - 1][0] - gapPenalty;
  for (let j = 1; j <= m; j++) dp[0][j] = dp[0][j - 1] - gapPenalty;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const match = dp[i - 1][j - 1] + waveMatch(a[i - 1], b[j - 1]);
      const del = dp[i - 1][j] - gapPenalty;
      const ins = dp[i][j - 1] - gapPenalty;
      dp[i][j] = Math.max(match, del, ins);
    }
  }

  const pairs: [number, number][] = [];
  const aOnly: number[] = [];
  const bOnly: number[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const match = dp[i - 1][j - 1] + waveMatch(a[i - 1], b[j - 1]);
    if (Math.abs(dp[i][j] - match) < 1e-9) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (Math.abs(dp[i][j] - (dp[i - 1][j] - gapPenalty)) < 1e-9) {
      aOnly.push(i - 1);
      i--;
    } else {
      bOnly.push(j - 1);
      j--;
    }
  }
  while (i > 0) {
    aOnly.push(i - 1);
    i--;
  }
  while (j > 0) {
    bOnly.push(j - 1);
    j--;
  }
  pairs.reverse();
  aOnly.reverse();
  bOnly.reverse();
  return { pairs, aOnly, bOnly };
}

/** 路线差异清单（多/少哪波、构成差异、顺序差异）。 */
export function routeDiff(a: RouteFingerprint, b: RouteFingerprint): RouteDiff {
  const aw = a.trashWaves;
  const bw = b.trashWaves;
  const { pairs, aOnly, bOnly } = alignWaves(aw, bw);
  const entries: RouteDiffEntry[] = [];

  for (const i of aOnly) {
    entries.push({ kind: "extra-a", aWave: i + 1, detail: `A 多出第 ${i + 1} 波：${describeWave(aw[i])}` });
  }
  for (const j of bOnly) {
    entries.push({ kind: "extra-b", bWave: j + 1, detail: `B 多出第 ${j + 1} 波：${describeWave(bw[j])}` });
  }

  for (const [i, j] of pairs) {
    const s = waveMatch(aw[i], bw[j]);
    if (s < 0.9) {
      entries.push({
        kind: "composition",
        aWave: i + 1,
        bWave: j + 1,
        detail: `A 第 ${i + 1} 波与 B 第 ${j + 1} 波构成差异（相似 ${s.toFixed(2)}）：A=${describeWave(aw[i])}；B=${describeWave(bw[j])}`,
      });
    }
  }

  const similarity = routeSimilarity(a, b);
  const contentSimilarity = multisetOverlap(npcMultiset(aw), npcMultiset(bw));
  const orderSimilarity = sequenceSimilarity(flattenNames(aw), flattenNames(bw));

  // 顺序差异：内容高度一致（同批怪）但顺序相似度明显偏低（被换序）。
  // 波级对齐是单调的、无法表示交叉换序，故用"内容 vs 顺序"落差判定。
  if (contentSimilarity > 0.6 && orderSimilarity < contentSimilarity - 0.15) {
    entries.push({ kind: "order", detail: "波次顺序存在差异（怪物构成一致但顺序不同）" });
  }

  const summary = entries.length === 0 ? "路线一致" : `${entries.length} 处差异`;
  return { similarity, contentSimilarity, orderSimilarity, entries, summary };
}
