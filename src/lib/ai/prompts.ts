import type { ProcessedLog } from "@/lib/parser/schema";
import { CHAPTER_OUTPUT_TOKEN_CAP, estimateTokens, TOKEN_BUDGET_PER_COMBAT } from "@/lib/ai/tokens";

/**
 * 章节提示词与数据切片（T5，ADR-001）。
 *  - 每章只发相关数据片段（不是全量 50K token）
 *  - 所有章节共享相同的 system 前缀 + 战斗概览前缀，
 *    命中 DeepSeek 上下文缓存（缓存命中输入价仅为 1/10）
 *  - 输出封顶 1800 token/章（maxTokens 参数）
 */

export const SHARED_SYSTEM_PREFIX = `你是《魔兽世界》大秘境复盘教练，服务于希望进步的中高端玩家。
输出要求：
1. 全部使用简体中文；技能名、专精名、副本名、药水名保留游戏内英文原名，不得翻译或自创叫法。
2. 所有结论必须引用本场 log 的真实证据：时间戳（分:秒）与技能名。禁止编造数据；数据不足时明确说"本场数据不足以判断"。
3. 时间戳格式统一为"分:秒"（如 12:34），与原始战斗日志一致。
4. 结构清晰，使用章节标题、列表与条目，整体阅读时长 3–8 分钟。
5. 不要输出与本场数据无关的泛泛之谈。
`;

export const CHAPTER_SPECIFIC_INSTRUCTIONS: Record<number, string> = {
  1: `【章节1】总体概览：用 3–5 条要点小结本场关键指标（输出、生存、打断、死亡等），不展开分析。`,
  2: `【章节2】关键时机分析：分析爆发、减伤、打断、移动等时机的表现，每条必须带时间戳+技能证据。`,
  3: `【章节3】与顶尖玩家对比：根据提供的对比基准，列出双方关键差异点（2–4 条）。若未提供对比数据，只输出"未提供对比链接，本场无对比章节。"。`,
  4: `【章节4】可改进点清单：每条必须遵循"现象 → 时间戳/技能证据 → 建议动作"三段式，只列真实证据支持的条目。`,
  5: `【章节5】战术意图识别：对每个"可疑操作"先检查是否存在战术合理性（对齐易伤/CD 规划/留资源/路线安排等），再下结论。
判定规则：
- 存在合理意图（如：无爆发时喝爆发药水是为了对齐 300 秒后的 BOSS 易伤；预留爆发对齐易伤窗口；提前开减伤覆盖高伤害机制；故意不断控以攒控链）→ 归入本章并解释"为什么是正确决策"。
- 无合理意图（如爆发期间长时间空转、漏断关键读条导致减员）→ 不得写进本章，应留给第 4 章可改进点。
输出格式：每条以"✅ 正确决策（MM:SS）：操作内容 —— 意图解释"列出；若无可识别样本则如实说明。`,
  6: `【章节6】下一步练习建议：给出 1–3 条可执行的具体练习（带场景与方法），聚焦本场暴露的问题。`,
};

export function buildChapterSystemPrompt(chapterNo: number): string {
  return `${SHARED_SYSTEM_PREFIX}\n${CHAPTER_SPECIFIC_INSTRUCTIONS[chapterNo]}`;
}

/** 战斗概览（所有章节共享的输入前缀，提升上下文缓存命中率）。 */
export function buildCombatOverview(log: ProcessedLog): string {
  const c = log.combat;
  return [
    `副本：${c.dungeon}（${c.level} 层）`,
    `复盘对象：${c.playerName}（${c.playerClass} ${c.playerSpec}）`,
    `战斗时长：${Math.round(c.durationSec)} 秒，结果：${c.success ? "限时成功" : "未限时完成"}`,
    `队伍：${c.players.map((p) => `${p.name}(${p.class}${p.spec && p.spec !== "Unknown" ? "/" + p.spec : ""})`).join("、") || "（无记录）"}`,
  ].join("\n");
}

/**
 * 章节数据切片（每章只发相关片段）。
 * 切片输出为 markdown+json 混合文本，供 AI 阅读。
 */
export function sliceForChapter(chapterNo: number, log: ProcessedLog): string {
  const c = log.combat;
  const agg = log.aggregate;
  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const overview = buildCombatOverview(log);

  switch (chapterNo) {
    case 1: {
      const totalDmg = agg.perMinute.reduce((s, b) => s + (b.damage ?? 0), 0);
      const totalHeal = agg.perMinute.reduce((s, b) => s + (b.heal ?? 0), 0);
      return [
        overview,
        `打断次数：${agg.interrupts.length}`,
        `玩家死亡：${agg.deaths.length} 次（${agg.deaths.map((d) => `${fmt(d.t)} ${d.actor}`).join("；") || "无"}）`,
        `爆发/CD/药水使用：${agg.cooldowns.length} 次`,
        `输出/治疗合计（分钟聚合）：伤害 ${Math.round(totalDmg)}，治疗 ${Math.round(totalHeal)}`,
        `易伤窗口：${agg.vulnerablePhases.map((v) => `${fmt(v.start)}–${fmt(v.end)}`).join("；") || "无"}`,
      ].join("\n");
    }
    case 2: {
      const cd = agg.cooldowns.slice(0, 40).map((e) => `${fmt(e.t)} ${e.actor} ${e.spell ?? ""}（${e.note ?? ""}）`);
      const intr = agg.interrupts.slice(0, 30).map((e) => `${fmt(e.t)} ${e.actor} 打断 ${e.spell ?? ""}`);
      const deaths = agg.deaths.map((e) => `${fmt(e.t)} ${e.actor} 死亡`);
      return [
        overview,
        "关键事件时间线（爆发/CD/药水/打断/死亡）：",
        ...cd,
        ...intr,
        ...deaths,
        agg.truncated ? "（注：原始数据过大，已做聚合压缩）" : "",
      ].join("\n");
    }
    case 3: {
      // 对比章节：结构化数据本身不含对比基准，由路由层注入 compareMeta 文本
      return overview + "\n对比基准：由调用方注入（见 prompt 拼接处 COMPARE_SECTION）。";
    }
    case 4:
    case 5: {
      const timeline = log.timeline.slice(0, 120).map((e) => {
        const base = `${fmt(e.t)} ${e.type} ${e.actor}${e.target ? " → " + e.target : ""} ${e.spell ?? ""}`;
        return base + (e.note ? `（${e.note}）` : "");
      });
      const perMinute = agg.perMinute.slice(0, 90).map((b) => `第${b.minute}分钟 ${b.player} 伤害${b.damage ?? 0} 治疗${b.heal ?? 0}${b.casts?.length ? ` 施放 ${b.casts.map((x) => `${x.spell}x${x.count}`).join(" ")}` : ""}`);
      return [
        overview,
        "关键事件时间线：",
        ...timeline,
        "",
        "分钟级输出/治疗聚合：",
        ...perMinute,
      ].join("\n");
    }
    case 6: {
      const deaths = agg.deaths.map((e) => `${fmt(e.t)} ${e.actor}`);
      const intr = agg.interrupts.map((e) => `${fmt(e.t)} ${e.spell ?? ""}`);
      return [
        overview,
        `死亡：${deaths.join("；") || "无"}`,
        `打断：${intr.join("；") || "无"}`,
        `易伤窗口：${agg.vulnerablePhases.map((v) => `${fmt(v.start)}–${fmt(v.end)}`).join("；") || "无"}`,
      ].join("\n");
    }
    default:
      return overview;
  }
}

/** 章节切片 token 估算（不得超出全量预算）。 */
export function estimateSliceTokens(slice: string): number {
  return estimateTokens(slice);
}

/**
 * 章节级 JSON 切片（I-6 成本修复）：只发该章需要的聚合字段，而非全量 aggregate。
 * 总体概览用 summary 口径，各章按需携带爆发/减伤/打断/死亡/易伤/位移等子集。
 * mock 提供器据此字段确定性生成内容；真实模型把它作为"引用证据"的紧凑视图。
 */
export function sliceJsonForChapter(
  chapterNo: number,
  log: ProcessedLog,
): Record<string, unknown> {
  const { combat, aggregate: agg } = log;
  switch (chapterNo) {
    case 1:
      return {
        combat,
        aggregate: {
          interrupts: agg.interrupts,
          deaths: agg.deaths,
          cooldowns: agg.cooldowns,
          vulnerablePhases: agg.vulnerablePhases,
          perMinute: agg.perMinute,
          truncated: agg.truncated,
        },
      };
    case 2:
      return {
        combat,
        aggregate: {
          cooldowns: agg.cooldowns,
          interrupts: agg.interrupts,
          deaths: agg.deaths,
          vulnerablePhases: agg.vulnerablePhases,
          truncated: agg.truncated,
        },
      };
    case 3:
      // 对比章节：结构化数据不含对比基准，由路由层注入 compareMeta 文本
      return { combat };
    case 4:
    case 5:
      // 意图识别/可改进点：需要爆发、易伤、死亡、打断、位移做规则判定
      return {
        combat,
        aggregate: {
          cooldowns: agg.cooldowns,
          vulnerablePhases: agg.vulnerablePhases,
          deaths: agg.deaths,
          interrupts: agg.interrupts,
          movement: agg.movement,
          truncated: agg.truncated,
        },
      };
    case 6:
      return {
        combat,
        aggregate: {
          deaths: agg.deaths,
          interrupts: agg.interrupts,
          vulnerablePhases: agg.vulnerablePhases,
          truncated: agg.truncated,
        },
      };
    default:
      return { combat };
  }
}

/** 构造完整用户消息（含章节切片 JSON 供 mock 解析 + 可读文本）。 */
export function buildChapterUserMessage(chapterNo: number, log: ProcessedLog): string {
  const slice = sliceForChapter(chapterNo, log);
  const json = JSON.stringify(sliceJsonForChapter(chapterNo, log));
  return `${slice}\n\n（以下为本场结构化数据 JSON，仅供引用证据：）\n\`\`\`json\n${json}\n\`\`\``;
}

export { CHAPTER_OUTPUT_TOKEN_CAP, TOKEN_BUDGET_PER_COMBAT };
