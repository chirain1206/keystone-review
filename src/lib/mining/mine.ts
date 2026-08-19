import type { CombatRun } from "@/lib/parser/parser";
import { parseCombatLog } from "@/lib/parser/parser";
import {
  runSuspectedTechniqueDetection,
  type IntentInput,
  type SuspectedVerdict,
} from "@/lib/ai/intent-engine";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * T20 高阶技巧批量挖掘（主动挖掘，FR-11 多 log 交叉挖掘）。
 *
 * 流程：逐份复用 FR-10 解析 + 意图引擎第三档判定（"疑似/知识库无法解释"条目）
 * → 以副本时间轴（转阶段/易伤窗口）为锚归一化相对时间 → 重复性检测
 * （同类型操作在 ≥2 份 log 的相似相对时间 ±容差 重复出现）→ 输出候选条目
 * + 证据汇总 + 置信度评分 → 生成 kb/inferred/ 源文件（origin=inferred、
 * status=candidate、source_url=internal:inference），幂等。
 *
 * 设计动机（PRD FR-11 / TECH-DESIGN）：单场出现可能是巧合，重复即意图。
 */

export interface MiningLog {
  id: string;
  dungeon: string;
  level: number;
  class: string;
  spec: string;
  intentInput: IntentInput;
}

export interface MinedOccurrence {
  logId: string;
  atSec: number;
  anchorNote: string;
  /** 相对锚点的偏移（负 = 锚点之前） */
  offsetSec: number;
  verdict: SuspectedVerdict;
}

export interface MinedPattern {
  key: string;
  label: string;
  occurrences: MinedOccurrence[];
  /** 出现该模式的去重 log 数 */
  support: number;
  /** 参与挖掘的 log 总数 */
  total: number;
  meanOffsetSec: number;
  spreadSec: number;
  /** 0–1 */
  confidence: number;
  evidence: string;
  verdicts: SuspectedVerdict[];
}

export interface MiningResult {
  patterns: MinedPattern[];
}

/** 重复性检测的最小 log 数（单场巧合、多场刻意）。 */
export const MIN_SUPPORT = 2;
/** 相对时间偏移聚类容差（秒）。 */
export const OFFSET_TOLERANCE_SEC = 5;
/** "高置信"阈值。 */
export const HIGH_CONFIDENCE = 0.7;

const PATTERN_LABELS: Record<string, string> = {
  "pet-preposition-before-phase": "宠物提前就位",
};

export function buildIntentInputFromRun(run: CombatRun): IntentInput {
  return {
    combat: {
      durationSec: run.combat.durationSec,
      dungeon: run.combat.dungeon,
      level: run.combat.level,
      playerName: run.combat.playerName,
    },
    aggregate: {
      cooldowns: run.aggregate.cooldowns,
      vulnerablePhases: run.aggregate.vulnerablePhases,
      deaths: run.aggregate.deaths,
      interrupts: run.aggregate.interrupts,
      movement: run.aggregate.movement,
    },
  };
}

/** 解析单个原始日志文件 → 每场大秘境一个 MiningLog。 */
export function parseMiningLogs(fileId: string, rawText: string): MiningLog[] {
  const parsed = parseCombatLog(rawText);
  if (!parsed.ok || !parsed.runs) return [];
  return parsed.runs.map((run, i) => ({
    id: `${fileId}#${i + 1}`,
    dungeon: run.combat.dungeon,
    level: run.combat.level,
    class: run.combat.playerClass,
    spec: run.combat.playerSpec,
    intentInput: buildIntentInputFromRun(run),
  }));
}

/** 核心：跨 log 挖掘重复"疑似"操作模式。 */
export function minePatterns(logs: MiningLog[]): MiningResult {
  const byKey = new Map<string, MinedOccurrence[]>();

  for (const log of logs) {
    // 第三档判定：知识库无法解释、证据链完整的"疑似"操作（挖掘目标）。
    // 第一/二档（intent/mistake）是"已解释"档，非挖掘对象（见 TECH-DESIGN 三档口径）。
    const verdicts = runSuspectedTechniqueDetection(log.intentInput, []);
    for (const v of verdicts) {
      const anchorNote = v.anchor?.note ?? "阶段";
      const offsetSec = v.anchor?.offsetSec ?? (v.atSec ?? 0);
      const list = byKey.get(v.key) ?? [];
      list.push({
        logId: log.id,
        atSec: v.atSec ?? offsetSec,
        anchorNote,
        offsetSec,
        verdict: v,
      });
      byKey.set(v.key, list);
    }
  }

  const patterns: MinedPattern[] = [];
  for (const [key, occ] of byKey) {
    const sorted = [...occ].sort((a, b) => a.offsetSec - b.offsetSec);
    // 按相对时间偏移聚类（±容差）
    const clusters: MinedOccurrence[][] = [];
    let cur: MinedOccurrence[] = [];
    for (const o of sorted) {
      if (cur.length === 0 || Math.abs(o.offsetSec - cur[cur.length - 1].offsetSec) <= OFFSET_TOLERANCE_SEC) {
        cur.push(o);
      } else {
        clusters.push(cur);
        cur = [o];
      }
    }
    if (cur.length) clusters.push(cur);

    for (const cl of clusters) {
      const logIds = new Set(cl.map((o) => o.logId));
      if (logIds.size < MIN_SUPPORT) continue;
      const support = logIds.size;
      const total = logs.length;
      const offsets = cl.map((o) => o.offsetSec);
      const mean = offsets.reduce((s, x) => s + x, 0) / offsets.length;
      const spread = Math.max(1, Math.round(Math.max(...offsets) - Math.min(...offsets)));
      const confidence = Math.min(0.95, 0.6 + 0.1 * support);
      const label = PATTERN_LABELS[key] ?? key;
      const dir = mean < 0 ? "前" : "后";
      const anchorNote = cl[0].anchorNote;
      const evidence = `${support}/${total} 份 log 中，在「${anchorNote}」${dir} ${Math.abs(Math.round(mean))}±${spread} 秒出现「${label}」`;
      patterns.push({
        key,
        label,
        occurrences: cl,
        support,
        total,
        meanOffsetSec: Math.round(mean),
        spreadSec: spread,
        confidence,
        evidence,
        verdicts: cl.map((o) => o.verdict),
      });
    }
  }

  patterns.sort((a, b) => b.confidence - a.confidence || b.support - a.support);
  return { patterns };
}

// ---------- kb/inferred 源文件生成（幂等） ----------

export interface CandidateMeta {
  class: string;
  spec: string;
  dungeon: string;
  patch: string;
}

/** 生成符合 kb/inferred 目录入库格式的候选条目 .md 内容（frontmatter + "## " 节）。 */
export function buildCandidateMarkdown(pattern: MinedPattern, meta: CandidateMeta): string {
  const body = pattern.verdicts.map((v) => v.explain).join("\n\n") || pattern.evidence;
  return [
    "---",
    `class: ${meta.class}`,
    `spec: ${meta.spec}`,
    `dungeon: ${meta.dungeon}`,
    `patch: ${meta.patch}`,
    "type: intent_pattern",
    "source_url: internal:inference",
    "---",
    "",
    "# log 推断候选（多 log 交叉挖掘）",
    "",
    `## 疑似技巧：${pattern.label}`,
    "",
    `${pattern.evidence}。`,
    "",
    body,
    "",
    `置信度：${Math.round(pattern.confidence * 100)}%。`,
    "",
  ].join("\n");
}

export function candidateFileName(meta: CandidateMeta, key: string): string {
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug(meta.class)}-${slug(meta.dungeon)}-${slug(key)}.md`;
}

/** 写入候选源文件；内容一致时跳过（幂等）。返回是否写入与文件路径。 */
export async function writeCandidateFile(
  dir: string,
  pattern: MinedPattern,
  meta: CandidateMeta,
): Promise<{ wrote: boolean; file: string }> {
  const content = buildCandidateMarkdown(pattern, meta);
  const file = path.join(dir, candidateFileName(meta, pattern.key));
  await fs.mkdir(dir, { recursive: true });
  try {
    const existing = await fs.readFile(file, "utf8");
    if (existing === content) return { wrote: false, file };
  } catch {
    // 文件不存在 → 写入
  }
  await fs.writeFile(file, content, "utf8");
  return { wrote: true, file };
}
