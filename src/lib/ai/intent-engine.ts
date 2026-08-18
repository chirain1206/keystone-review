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
    movement: { t: number; spell?: string }[];
  };
}

export function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
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
