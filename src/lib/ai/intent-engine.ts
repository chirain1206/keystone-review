import type { CombatSummary } from "@/lib/parser/schema";

/**
 * 战术意图识别引擎（T6，FR-5 —— 产品命根子）。
 *
 * 核心原则：对每个"可疑操作"先检查战术合理性
 * （对齐易伤 / CD 规划 / 留资源 / 减伤预铺 / 控链规划 / 风筝路线等），
 * 再决定列为"可改进点（失误）"还是"有意图的正确决策"。
 *
 * 本引擎是确定性规则引擎，服务于：
 *  1) mock 模式报告第 4/5 章生成；
 *  2) 样例集评测脚本（eval/intent-eval.ts，QA 阶段以真实模型跑 ≥80% 通过率）。
 * 真实模型走第 5 章提示词（buildChapterSystemPrompt(5)）中的完整判定规则，
 * 本引擎的判定口径与提示词保持一致。
 */

export type Verdict = "intent" | "mistake";

export interface IntentVerdict {
  key: string; // 模式 key（样例集 expectedKey 对齐）
  verdict: Verdict;
  explain: string; // 中文解释（引用时间戳）
  atSec?: number; // 主要时间点
}

export interface IntentInput {
  combat: Pick<CombatSummary, "durationSec" | "dungeon" | "level" | "playerName">;
  aggregate: {
    cooldowns: { t: number; spell?: string; note?: string; actor?: string }[];
    vulnerablePhases: { start: number; end: number; note?: string }[];
    deaths: { t: number; actor?: string }[];
    interrupts: { t: number; spell?: string }[];
    movement: { t: number; spell?: string; actor?: string }[];
  };
}

export function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------- 领域知识依赖型意图（FR-11，T16/T17） ----------

/**
 * 知识依赖型意图的"结构化判定块"（mock 基线用；真实模型读自然语言知识）。
 * 格式（出现在知识片段文本内）：
 *   【意图:<key>】
 *   {"kind":"...", ...条件参数}
 *   【解释】中文解释，可用 {t} 占位替换为关键时间点【/意图】
 * 生产知识内容（kb/sources/*.md）不含该结构 —— 它是评测 fixture 与 mock 基线的
 * 判定载体；真实模型按第 5 章提示词对自然语言知识做同样的判定。
 */
export interface IntentBlock {
  key: string;
  kind: string;
  conditions: Record<string, unknown>;
  explain: string;
}

export function extractIntentBlocks(text: string): IntentBlock[] {
  const out: IntentBlock[] = [];
  const re = /【意图:([a-z0-9-]+)】\s*(\{[\s\S]*?\})\s*(?:【解释】([\s\S]*?))?【\/意图】/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      out.push({
        key: m[1],
        kind: (JSON.parse(m[2]) as { kind?: string }).kind ?? m[1],
        conditions: JSON.parse(m[2]) as Record<string, unknown>,
        explain: (m[3] ?? "").trim(),
      });
    } catch {
      // 非法块跳过（视为普通知识文本）
    }
  }
  return out;
}

export interface KnowledgeVerdict {
  key: string;
  verdict: "intent";
  explain: string;
  atSec?: number;
}

function num(c: Record<string, unknown>, k: string, dflt: number): number {
  const v = c[k];
  return typeof v === "number" ? v : dflt;
}

function evaluateIntentBlock(block: IntentBlock, input: IntentInput): KnowledgeVerdict | null {
  const { aggregate: agg } = input;
  const isProc = (c: { note?: string }) => (c.note ?? "").includes("触发");
  const bursts = agg.cooldowns.filter(isBurst);
  const buffs = agg.cooldowns.filter(
    (c) => !(c.spell ?? "").toLowerCase().includes("potion") && (c.note ?? "").includes("获得增益"),
  );
  const procs = agg.cooldowns.filter(
    (c) => !(c.spell ?? "").toLowerCase().includes("potion") && isProc(c),
  );
  const potions = agg.cooldowns.filter(isPotionCast);
  const vulns = agg.vulnerablePhases;
  const interrupts = agg.interrupts;
  const c = block.conditions;

  let atSec: number | null = null;
  let ok = false;

  switch (block.kind) {
    case "gather-before-burst": {
      // 怪聚齐前打资源/赌 buff 触发，聚齐后带最佳增益爆发：
      // [0,noBurstBefore) 无爆发；存在 t≥burstAfter 的爆发；
      // 爆发前 within 秒内触发类增益获得 ≥ min 次（触发与爆发区分开，避免互斥）
      const noBurstBefore = num(c, "noBurstBefore", 40);
      const burstAfter = num(c, "burstAfter", 40);
      const within = num(c, "buffWithin", 30);
      const minBuffs = num(c, "minBuffs", 2);
      const early = bursts.some((b) => b.t < noBurstBefore);
      const late = bursts.filter((b) => b.t >= burstAfter);
      for (const b of late) {
        const buffsNear = [...procs, ...buffs].filter(
          (x) => x !== b && x.t <= b.t && x.t >= b.t - within,
        ).length;
        if (!early && buffsNear >= minBuffs) {
          atSec = b.t;
          ok = true;
          break;
        }
      }
      break;
    }
    case "hold-burst-next-vuln": {
      // 留爆发对齐下一波易伤：爆发开在 [0,burstBefore]，且下一波易伤在 vulnAfter 之后
      const burstBefore = num(c, "burstBefore", 60);
      const vulnAfter = num(c, "vulnAfter", 90);
      const inVuln = (t: number) => vulns.some((v) => t >= v.start && t <= v.end);
      for (const b of bursts) {
        if (b.t <= burstBefore && !inVuln(b.t) && vulns.some((v) => v.start >= vulnAfter)) {
          atSec = b.t;
          ok = true;
          break;
        }
      }
      break;
    }
    case "quiet-resource-window": {
      // 资源循环停手/攒资源窗口：[ws,we) 内无任何技能使用（触发类增益不算施放），
      // 但有 ≥minBuffs 次触发类增益获得
      const ws = num(c, "windowStart", 60);
      const we = num(c, "windowEnd", 120);
      const minBuffs = num(c, "minBuffs", 1);
      const anyCd = agg.cooldowns.some((x) => x.t >= ws && x.t < we && !isProc(x));
      const buffsIn = procs.filter((x) => x.t >= ws && x.t < we).length;
      if (!anyCd && buffsIn >= minBuffs) {
        atSec = ws;
        ok = true;
      }
      break;
    }
    case "late-interrupt-by-design": {
      // 故意延后打断（等聚怪/控链）：[0,noInterruptBefore) 零打断，其后 ≥min 次
      const noInterruptBefore = num(c, "noInterruptBefore", 120);
      const minAfter = num(c, "minInterruptsAfter", 2);
      const early = interrupts.some((i) => i.t < noInterruptBefore);
      const lateCount = interrupts.filter((i) => i.t >= noInterruptBefore).length;
      if (!early && lateCount >= minAfter) {
        atSec = interrupts.find((i) => i.t >= noInterruptBefore)?.t ?? noInterruptBefore;
        ok = true;
      }
      break;
    }
    case "burst-late-in-vuln": {
      // 易伤后半段才开爆发（机制要求先走位/先处理其他目标）：
      // 爆发落在易伤窗口内且位于窗口后 lastFraction 段
      const lastFraction = num(c, "lastFraction", 0.34);
      for (const b of bursts) {
        for (const v of vulns) {
          if (b.t >= v.start && b.t <= v.end) {
            const remain = (v.end - b.t) / Math.max(1, v.end - v.start);
            if (remain <= lastFraction) {
              atSec = b.t;
              ok = true;
              break;
            }
          }
        }
        if (ok) break;
      }
      break;
    }
    case "pet-preposition": {
      // 转阶段前宠物/召唤物提前就位规避落地伤害（领域知识解释版）：
      // 阶段开始前 [beforeLo,beforeHi] 秒内，非主角玩家单位位移 ≥minMoves 次
      const beforeLo = num(c, "beforeLo", 2);
      const beforeHi = num(c, "beforeHi", 25);
      const minMoves = num(c, "minMoves", 2);
      const subject = input.combat.playerName ?? "";
      for (const v of vulns) {
        const pre = agg.movement
          .filter(
            (m) =>
              m.actor && m.actor !== subject && v.start - m.t >= beforeLo && v.start - m.t <= beforeHi,
          )
          .sort((a, b) => a.t - b.t);
        if (pre.length >= minMoves) {
          atSec = pre[0].t;
          ok = true;
          break;
        }
      }
      break;
    }
    default:
      return null;
  }

  void potions;
  if (!ok) return null;
  const explain = (block.explain || "该操作符合该专精的领域打法知识，判断为有意图的正确决策。").replaceAll(
    "{t}",
    atSec !== null ? fmt(atSec) : "—",
  );
  return { key: block.key, verdict: "intent", explain, atSec: atSec ?? undefined };
}

/** 知识辅助判定：扫描知识文本中的结构化判定块并求值。 */
export function runKnowledgeIntentDetection(
  input: IntentInput,
  knowledgeTexts: string[],
): KnowledgeVerdict[] {
  const out: KnowledgeVerdict[] = [];
  const seen = new Set<string>();
  for (const text of knowledgeTexts) {
    for (const block of extractIntentBlocks(text)) {
      if (seen.has(block.key)) continue;
      seen.add(block.key);
      const v = evaluateIntentBlock(block, input);
      if (v) out.push(v);
    }
  }
  return out;
}

// ---------- 疑似高阶技巧（FR-5 第三档，T19） ----------

/**
 * "疑似高阶技巧"判定：知识库解释不了、但证据链完整的异常操作。
 * 不武断判失误 —— 输出"疑似技巧 + 证据 + 推断理由"，并沉淀为候选条目
 * （origin=inferred、status=candidate，绝不注入正式分析）。
 */
export interface SuspectedVerdict {
  key: string;
  verdict: "suspected";
  explain: string; // 含证据与推断理由
  evidence: string;
  atSec?: number;
  /**
   * 归一化锚点（T20 多 log 交叉挖掘用）：把"何时发生"换算成"相对副本时间轴锚点的偏移"，
   * 使不同 log 的相似操作可在统一坐标系下做重复性检测。
   * note = 锚点说明（如易伤/阶段名），offsetSec = atSec - 锚点起点（可为负，负 = 锚点之前）。
   */
  anchor?: { note: string; offsetSec: number };
}

export function runSuspectedTechniqueDetection(
  input: IntentInput,
  explainedByKnowledge: { atSec?: number }[],
): SuspectedVerdict[] {
  const out: SuspectedVerdict[] = [];
  const { aggregate: agg, combat } = input;
  const subject = combat.playerName ?? "";

  // 规则 1：转阶段前宠物/非玩家单位提前就位
  // 证据链：阶段开始前 25–2 秒内，非主角玩家单位连续位移 ≥2 次。
  // 该窗口避开 kite-before-phase（玩家自身位移）的 10 秒规则窗，不与其冲突。
  for (const v of agg.vulnerablePhases) {
    const pre = agg.movement
      .filter(
        (m) =>
          m.actor && m.actor !== subject && v.start - m.t >= 2 && v.start - m.t <= 25,
      )
      .sort((a, b) => a.t - b.t);
    if (pre.length < 2) continue;

    const knowledgeExplains = explainedByKnowledge.some(
      (k) => k.atSec !== undefined && Math.abs(k.atSec - pre[0].t) <= 20,
    );
    if (knowledgeExplains) continue; // 知识已解释 → 归为意图，不判疑似

    const spells = pre.map((m) => m.spell ?? "位移").join("、");
    const evidence = `非玩家单位「${pre[0].actor}」在 ${fmt(pre[0].t)}–${fmt(pre[pre.length - 1].t)} 连续位移 ${pre.length} 次（${spells}），位于阶段切换（${fmt(v.start)} 起）前 25 秒内；该单位非复盘对象本人。`;
    out.push({
      key: "pet-preposition-before-phase",
      verdict: "suspected",
      atSec: pre[0].t,
      // 跨 log 归一化锚点：相对该易伤/阶段窗口起点的偏移（负 = 阶段开始前）
      anchor: { note: v.note ?? "阶段", offsetSec: pre[0].t - v.start },
      evidence,
      explain: `${evidence} 推断：可能是提前指挥宠物/召唤物走位就位，以规避转阶段落地/机制伤害的高阶技巧。知识库暂无对应解释，不武断判为失误，已沉淀为候选条目待人工审查。`,
    });
  }

  return out;
}

type CD = { t: number; spell?: string; note?: string; actor?: string };

const isPotionCast = (c: CD) =>
  (c.spell ?? "").toLowerCase().includes("potion") && (c.note ?? "").includes("药水");
const isBurst = (c: CD) =>
  !(c.spell ?? "").toLowerCase().includes("potion") && (c.note ?? "").includes("获得增益");
const isDefensive = (c: CD) => (c.note ?? "").includes("减伤");

export function runIntentEngine(input: IntentInput): IntentVerdict[] {
  const out: IntentVerdict[] = [];
  const { aggregate: agg, combat } = input;
  const cooldowns = agg.cooldowns;
  const vulns = agg.vulnerablePhases;
  const deaths = agg.deaths;
  const interrupts = agg.interrupts;
  const movement = agg.movement;

  const potions = cooldowns.filter(isPotionCast);
  const bursts = cooldowns.filter(isBurst);
  const defensives = cooldowns.filter(isDefensive);

  const inAnyVuln = (t: number) => vulns.some((v) => t >= v.start && t <= v.end);
  const vulnAfter = (t: number, lo: number, hi: number) =>
    vulns.find((v) => v.start - t >= lo && v.start - t <= hi);

  // ---------- 意图模式（正确决策） ----------

  // 1. 无爆发时喝爆发药水，但 4–6 分钟后存在易伤阶段 → 卡药水 CD 对齐易伤的意图
  for (const p of potions) {
    const nearBurst = bursts.some((b) => Math.abs(b.t - p.t) <= 25);
    const v = vulnAfter(p.t, 240, 360);
    if (!nearBurst && v) {
      out.push({
        key: "potion-align-vulnerable",
        verdict: "intent",
        atSec: p.t,
        explain: `在 ${fmt(p.t)} 无爆发增益时使用 ${p.spell}，看似浪费：但本场 ${fmt(v.start)} 起存在 BOSS 易伤阶段（${v.note ?? "易伤"}），本次使用使药水 5 分钟 CD 恰好在易伤阶段转好，下一次药水窗口将覆盖易伤——属于「卡 CD 对齐易伤」的意图决策，判断为正确操作。`,
      });
    }
  }

  // 2. 爆发紧贴易伤阶段开启（±2s~前 8s）→ 留爆发对齐易伤
  for (const b of bursts) {
    const rightBefore = vulns.some((v) => v.start - b.t >= -2 && v.start - b.t <= 8);
    if (rightBefore) {
      out.push({
        key: "hold-burst-for-vuln",
        verdict: "intent",
        atSec: b.t,
        explain: `在 ${fmt(b.t)} 开启 ${b.spell ?? "爆发技能"}，紧贴易伤阶段开启时间：这是把爆发对齐易伤窗口的规划，判断为正确决策。`,
      });
    }
  }

  // 3. 易伤阶段前 5 秒内预开减伤 → 覆盖高伤害机制的意图
  for (const d of defensives) {
    const before = vulns.some((v) => v.start - d.t >= 0 && v.start - d.t <= 5);
    if (before) {
      out.push({
        key: "defensive-before-phase",
        verdict: "intent",
        atSec: d.t,
        explain: `在 ${fmt(d.t)}（易伤/高伤害机制开启前 5 秒内）提前开启 ${d.spell ?? "减伤"}：预铺减伤覆盖机制峰值，判断为正确决策。`,
      });
    }
  }

  // 4. 预铺减伤且机制期间无人死亡 → 减伤规划有效
  for (const d of defensives) {
    const v = vulns.find((x) => x.start - d.t >= 0 && x.start - d.t <= 5);
    if (v && !deaths.some((dd) => dd.t >= v.start && dd.t <= v.end)) {
      out.push({
        key: "pre-defensive-no-death",
        verdict: "intent",
        atSec: d.t,
        explain: `${fmt(d.t)} 预开的 ${d.spell ?? "减伤"} 覆盖了 ${fmt(v.start)} 起的机制窗口，期间全队零死亡：减伤规划有效，判断为正确决策。`,
      });
    }
  }

  // 5. 20 秒内 ≥3 次打断（同目标控链/打断链）→ 攒控意图
  {
    const sorted = [...interrupts].sort((a, b) => a.t - b.t);
    for (let i = 0; i + 2 < sorted.length; i++) {
      const w = sorted.slice(i, i + 3);
      if (w[2].t - w[0].t <= 20) {
        out.push({
          key: "interrupt-chain",
          verdict: "intent",
          atSec: w[0].t,
          explain: `${fmt(w[0].t)}–${fmt(w[2].t)} 20 秒内连续 3 次打断（${w.map((x) => x.spell ?? "").join("、")}）：这是有规划的打断轮换/控链，判断为正确决策。`,
        });
        break;
      }
    }
  }

  // 6. 所有爆发都落在易伤窗口内 → 严格对齐意图
  if (bursts.length > 0 && vulns.length > 0 && bursts.every((b) => inAnyVuln(b.t))) {
    out.push({
      key: "burst-only-in-vuln",
      verdict: "intent",
      atSec: bursts[0].t,
      explain: `本场全部爆发（${bursts.map((b) => fmt(b.t)).join("、")}）均落在易伤窗口内：爆发资源 100% 对齐易伤，判断为正确决策。`,
    });
  }

  // 7. 易伤前 10 秒内 ≥3 次位移 → 主动走位/风筝意图
  {
    for (const v of vulns) {
      const pre = movement.filter((m) => v.start - m.t >= 0 && v.start - m.t <= 10);
      if (pre.length >= 3) {
        out.push({
          key: "kite-before-phase",
          verdict: "intent",
          atSec: pre[0].t,
          explain: `${fmt(v.start)} 机制前 10 秒内连续位移 ${pre.length} 次（${pre.map((m) => m.spell ?? "").join("、")}）：主动走位规避/风筝，判断为正确决策。`,
        });
        break;
      }
    }
  }

  // 8. 易伤开启后 5 秒内开爆发 → 爆发卡易伤起手
  for (const b of bursts) {
    const v = vulns.find((x) => b.t - x.start >= 0 && b.t - x.start <= 5);
    if (v) {
      out.push({
        key: "burst-at-phase-start",
        verdict: "intent",
        atSec: b.t,
        explain: `${fmt(b.t)} 在 ${fmt(v.start)} 易伤开启后 5 秒内开启 ${b.spell ?? "爆发"}：卡易伤起手最大化增益覆盖，判断为正确决策。`,
      });
    }
  }

  // 9. 易伤前 45 秒完全留资源（无任何 CD），随后爆发在易伤内 → 留资源意图
  {
    for (const v of vulns) {
      const quietBefore = !cooldowns.some((c) => c.t >= v.start - 45 && c.t < v.start);
      const burstIn = bursts.some((b) => b.t >= v.start && b.t <= v.end);
      if (quietBefore && burstIn) {
        out.push({
          key: "resource-pooling",
          verdict: "intent",
          atSec: v.start,
          explain: `${fmt(v.start)} 易伤前 45 秒内未使用任何爆发/CD，资源全部留给易伤窗口：留资源规划，判断为正确决策。`,
        });
      }
    }
  }

  // 10. 药水增益窗口与易伤窗口重叠 ≥50% → 药水窗口规划
  for (const p of potions) {
    const v = vulns.find((x) => {
      const overlapStart = Math.max(p.t, x.start);
      const overlapEnd = Math.min(p.t + 30, x.end);
      const overlap = overlapEnd - overlapStart;
      return overlap >= 15;
    });
    if (v) {
      out.push({
        key: "potion-window-covers-vuln",
        verdict: "intent",
        atSec: p.t,
        explain: `${fmt(p.t)} 使用的 ${p.spell} 30 秒增益窗口与 ${fmt(v.start)} 起的易伤阶段重叠：药水窗口经过规划，判断为正确决策。`,
      });
    }
  }

  // ---------- 失误模式（列入第 4 章可改进点） ----------

  // M1. 爆发后 15 秒内无任何其他动作/无易伤/无死亡 → 爆发期空转
  // （爆发本身落在易伤窗口内的不判空转）
  for (const b of bursts) {
    if (inAnyVuln(b.t)) continue;
    const anything = cooldowns.some(
      (c) => c !== b && c.t > b.t && c.t <= b.t + 15,
    );
    const vulnSoon = vulns.some((v) => v.start > b.t && v.start <= b.t + 15);
    const died = deaths.some((d) => d.t > b.t && d.t <= b.t + 15);
    if (!anything && !vulnSoon && !died) {
      out.push({
        key: "wasted-burst",
        verdict: "mistake",
        atSec: b.t,
        explain: `${fmt(b.t)} 开启 ${b.spell ?? "爆发"} 后 15 秒内无任何其他技能记录（无易伤、无死亡干扰），疑似爆发期空转，建议爆发前确认目标与资源，爆发期内保持技能循环不间断。`,
      });
    }
  }

  // M2. 喝药水后 6 分钟内既无爆发也无易伤 → 药水浪费
  for (const p of potions) {
    const nearBurst = bursts.some((b) => Math.abs(b.t - p.t) <= 25);
    const vulnSoon = vulnAfter(p.t, 0, 360);
    if (!nearBurst && !vulnSoon) {
      out.push({
        key: "potion-wasted",
        verdict: "mistake",
        atSec: p.t,
        explain: `${fmt(p.t)} 使用 ${p.spell}，但前后 25 秒内无爆发、之后 6 分钟内也无易伤窗口：药水增益被浪费，建议把药水对齐爆发或易伤阶段。`,
      });
    }
  }

  // M3. 易伤阶段内死亡 → 机制/减伤失误
  for (const d of deaths) {
    const v = vulns.find((x) => d.t >= x.start && d.t <= x.end);
    if (v) {
      out.push({
        key: "death-in-vuln",
        verdict: "mistake",
        atSec: d.t,
        explain: `${fmt(d.t)} ${d.actor ?? "玩家"} 在 ${fmt(v.start)} 起的易伤/机制阶段内死亡：机制期减员，建议复盘该时间点减伤覆盖与治疗资源。`,
      });
    }
  }

  // M4. 两个爆发 10 秒内重叠且不在易伤窗口内 → 增益叠加浪费
  // （易伤窗口内叠加爆发是标准打法——把多个增益同时对齐易伤，不判失误）
  {
    const sorted = [...bursts].sort((a, b) => a.t - b.t);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (b.t - a.t <= 10 && !inAnyVuln(a.t) && !inAnyVuln(b.t)) {
        out.push({
          key: "burst-overlap",
          verdict: "mistake",
          atSec: a.t,
          explain: `${fmt(a.t)} 与 ${fmt(b.t)} 两个爆发（${a.spell} / ${b.spell}）10 秒内重叠开启且不在易伤窗口内，增益窗口浪费，建议错峰开启或把叠加留给易伤阶段。`,
        });
        break;
      }
    }
  }

  // M5. 整场零打断 → 漏断风险
  if (interrupts.length === 0) {
    out.push({
      key: "zero-interrupts",
      verdict: "mistake",
      atSec: 0,
      explain: "整场战斗未记录到任何打断：存在漏断高危读条的风险，建议与队伍约定打断分工。",
    });
  }

  // M6. 战斗结束前 40 秒内喝药水 → 增益用不完
  for (const p of potions) {
    if (combat.durationSec - p.t < 40 && combat.durationSec > 0) {
      out.push({
        key: "potion-at-fight-end",
        verdict: "mistake",
        atSec: p.t,
        explain: `${fmt(p.t)} 在战斗结束前 ${Math.round(combat.durationSec - p.t)} 秒使用 ${p.spell}：增益窗口无法用满，建议提前规划药水时机。`,
      });
    }
  }

  return out;
}
