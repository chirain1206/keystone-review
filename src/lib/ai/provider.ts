import { envConfig, requireProductionEnv } from "@/lib/env";
import { estimateTokens } from "@/lib/ai/tokens";
import { runIntentEngine } from "@/lib/ai/intent-engine";

/**
 * AI 适配层（T5）。
 *  - 有 DEEPSEEK_API_KEY → DeepSeek deepseek-chat 流式（含 usage 统计、上下文缓存自动生效）
 *  - 无密钥（开发/mock）→ MockAiProvider：基于结构化数据生成确定性章节内容，
 *    同样流式回调，全流程可离线自测（含 FR-5 战术意图样例的规则判定）。
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamCallbacks {
  onDelta?: (text: string) => void;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface AiProvider {
  readonly mode: "deepseek" | "mock";
  chat(messages: ChatMessage[], opts: ChatOptions, cb?: StreamCallbacks): Promise<ChatResult>;
}

// ---- 成本单价（美元/百万 token，DeepSeek 定价；缓存命中输入价 1/10）----
export const PRICE_INPUT_PER_M = 0.28;
export const PRICE_CACHED_INPUT_PER_M = 0.028;
export const PRICE_OUTPUT_PER_M = 0.42;

// ---------- DeepSeek ----------

interface DeepSeekStreamChunk {
  choices?: { delta?: { content?: string } }[];
  usage?: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };
}

class DeepSeekProvider implements AiProvider {
  readonly mode = "deepseek" as const;

  async chat(
    messages: ChatMessage[],
    opts: ChatOptions,
    cb?: StreamCallbacks,
  ): Promise<ChatResult> {
    const url = `${envConfig.deepseekBaseUrl.replace(/\/$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${envConfig.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: envConfig.deepseekModel,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: opts.maxTokens,
        temperature: opts.temperature ?? 0.4,
      }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      // L-4：上游细节只进服务端日志，抛给调用方的是不泄露内部信息的友好文案
      console.error(`[ai] DeepSeek API ${res.status}: ${body.slice(0, 300)}`);
      throw new Error("AI 服务暂时不可用，请稍后重试");
    }

    let content = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let cacheHit = 0;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload) as DeepSeekStreamChunk;
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            content += delta;
            cb?.onDelta?.(delta);
          }
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens;
            completionTokens = chunk.usage.completion_tokens;
            cacheHit = chunk.usage.prompt_cache_hit_tokens ?? 0;
          }
        } catch {
          // 忽略不完整行
        }
      }
    }
    const cacheMiss = Math.max(0, promptTokens - cacheHit);
    const costUsd =
      (cacheMiss / 1e6) * PRICE_INPUT_PER_M +
      (cacheHit / 1e6) * PRICE_CACHED_INPUT_PER_M +
      (completionTokens / 1e6) * PRICE_OUTPUT_PER_M;
    return {
      content,
      tokensIn: promptTokens || estimateTokens(JSON.stringify(messages)),
      tokensOut: completionTokens || estimateTokens(content),
      costUsd,
    };
  }
}

// ---------- Mock ----------

// ---------- Mock ----------

/**
 * mock 模式的 FR-5 判定由意图引擎（T6）提供：
 * 报告第 4 章列"失误"判定，第 5 章列"正确决策"判定。
 * 真实模型走第 5 章提示词的完整规则（与引擎口径一致）。
 */
function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

class MockAiProvider implements AiProvider {
  readonly mode = "mock" as const;

  async chat(
    messages: ChatMessage[],
    opts: ChatOptions,
    cb?: StreamCallbacks,
  ): Promise<ChatResult> {
    const content = this.generate(messages, opts);
    const tokensIn = estimateTokens(messages.map((m) => m.content).join("\n"));
    const tokensOut = estimateTokens(content);
    return { content, tokensIn, tokensOut, costUsd: 0 };
  }

  /** 根据 system 提示词中的章节标记生成确定性内容（流式由管线自行切分）。 */
  private generate(messages: ChatMessage[], opts: ChatOptions): string {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages.find((m) => m.role === "user")?.content ?? "";

    // 问答分支（T7）
    if (system.includes("问答助手")) {
      return this.generateQaAnswer(user, opts);
    }

    const chapterMatch = /【章节(\d)】/.exec(system) ?? /章节(\d)/.exec(system);
    const chapterNo = chapterMatch ? Number(chapterMatch[1]) : 1;

    // 从 user 内容提取结构化数据（管线注入的 JSON 片段）
    let log: {
      combat?: { dungeon?: string; level?: number; playerName?: string; playerClass?: string; success?: boolean; durationSec?: number };
      aggregate?: {
        interrupts?: { t: number; spell?: string }[];
        deaths?: { t: number; actor?: string }[];
        cooldowns?: { t: number; spell?: string; note?: string; actor?: string }[];
        vulnerablePhases?: { start: number; end: number; note?: string }[];
        movement?: { t: number; spell?: string }[];
        perMinute?: { damage?: number; heal?: number }[];
      };
    } = {};
    const jsonMatch = /```json\n([\s\S]*?)\n```/.exec(user) ?? /(\{[\s\S]*"aggregate"[\s\S]*\})/.exec(user);
    if (jsonMatch) {
      try {
        log = JSON.parse(jsonMatch[1]) as typeof log;
      } catch {
        // 保持默认
      }
    }
    const combat = log.combat ?? {};
    const agg = log.aggregate ?? {};
    const dungeon = combat.dungeon ?? "本场战斗";
    const level = combat.level ?? 0;
    const player = combat.playerName ?? "你";

    const interrupts = agg.interrupts ?? [];
    const deaths = agg.deaths ?? [];
    const cooldowns = agg.cooldowns ?? [];
    const vuln = agg.vulnerablePhases ?? [];
    const totalDmg = (agg.perMinute ?? []).reduce((s, b) => s + (b.damage ?? 0), 0);

    const verdicts = runIntentEngine({
      combat: {
        durationSec: combat.durationSec ?? 0,
        dungeon: dungeon,
        level,
        playerName: player,
      },
      aggregate: {
        cooldowns,
        vulnerablePhases: vuln,
        deaths,
        interrupts,
        movement: agg.movement ?? [],
      },
    });
    const intentVerdicts = verdicts.filter((v) => v.verdict === "intent");
    const mistakeVerdicts = verdicts.filter((v) => v.verdict === "mistake");

    const lines: string[] = [];
    switch (chapterNo) {
      case 1:
        lines.push(
          `本场为 ${dungeon} ${level} 层大秘境，复盘对象为 ${player}。`,
          `战斗时长约 ${Math.round((combat.durationSec ?? 0) / 60)} 分钟，结果：${combat.success ? "限时成功" : "超时/未完成"}。`,
          `全队关键事件统计：打断 ${interrupts.length} 次，玩家死亡 ${deaths.length} 次，爆发/CD/药水使用 ${cooldowns.length} 次，BOSS 易伤窗口 ${vuln.length} 个。`,
          totalDmg > 0
            ? `本场输出总量约 ${Math.round(totalDmg / 1e4) / 100} 亿伤害（结构化聚合估算）。`
            : "输出总量较小或日志未包含伤害事件。",
        );
        break;
      case 2:
        lines.push("关键时机表现：");
        if (interrupts.length > 0) {
          lines.push(
            `- 打断：共 ${interrupts.length} 次，包括 ${interrupts.slice(0, 3).map((i) => `${fmt(i.t)} 打断 ${i.spell ?? "关键技能"}`).join("、")}。`,
          );
        } else {
          lines.push("- 打断：本场未记录到玩家打断事件，需要留意。");
        }
        if (cooldowns.length > 0) {
          lines.push(
            `- 爆发/CD：${cooldowns.slice(0, 5).map((c) => `${fmt(c.t)} ${c.actor ?? ""} ${c.spell ?? ""}（${c.note ?? "使用"}）`).join("；")}。`,
          );
        }
        if (vuln.length > 0) {
          lines.push(
            `- 易伤阶段：${vuln.map((v) => `${fmt(v.start)}–${fmt(v.end)} ${v.note ?? ""}`).join("；")}。`,
          );
        }
        if (deaths.length > 0) {
          lines.push(`- 死亡：${deaths.map((d) => `${fmt(d.t)} ${d.actor}`).join("；")}。`);
        }
        break;
      case 3:
        lines.push("未提供对比链接，本场无对比章节（FR-3：未粘贴则不显示本章）。");
        break;
      case 4: {
        lines.push("可改进点清单：");
        let idx = 0;
        for (const m of mistakeVerdicts) {
          idx++;
          lines.push(`${idx}. 现象：${m.explain}（证据如上）建议：针对该时间点复盘操作规划，制定对应改进动作。`);
        }
        // 补充：非机制期的死亡也单列
        for (const d of deaths) {
          const inVuln = vuln.some((v) => d.t >= v.start && d.t <= v.end);
          if (!inVuln && !mistakeVerdicts.some((m) => m.atSec === d.t)) {
            idx++;
            lines.push(
              `${idx}. 现象：战斗中期出现玩家死亡。证据：${fmt(d.t)} ${d.actor ?? ""} 死亡。建议：复盘该时间点减伤覆盖与治疗资源规划，避免关键机制期减员。`,
            );
          }
        }
        if (interrupts.length < 2 && !mistakeVerdicts.some((m) => m.key === "zero-interrupts")) {
          idx++;
          lines.push(
            `${idx}. 现象：本场打断次数偏低。证据：全场仅记录到少量打断事件。建议：与队伍约定打断分工，优先打断高危读条（如治疗类与群控类技能）。`,
          );
        }
        if (idx === 0) {
          lines.push("1. 未发现明显的可改进点，保持现有节奏，可关注爆发对齐的细节（见第 5 章）。");
        }
        break;
      }
      case 5: {
        lines.push("战术意图识别：");
        if (intentVerdicts.length > 0) {
          for (const v of intentVerdicts) {
            lines.push(`- ✅ 正确决策（${v.atSec !== undefined ? fmt(v.atSec) : "—"}）：${v.explain}`);
          }
        } else {
          lines.push("- 本场未发现「看似异常实为正确决策」的样本操作。");
        }
        if (mistakeVerdicts.length > 0) {
          lines.push(
            `- 另有 ${mistakeVerdicts.length} 处真实失误（如 ${mistakeVerdicts[0].atSec !== undefined ? fmt(mistakeVerdicts[0].atSec) : "全程"}），已列入第 4 章「可改进点」，不归入本章。`,
          );
        }
        break;
      }
      case 6:
        lines.push(
          "下一步练习建议：",
          "1. 爆发对齐练习：记录每次爆发的开启时间与 BOSS 易伤窗口，做到爆发 100% 覆盖易伤阶段（可参考第 5 章的意图案例）。",
          "2. 打断轮换练习：与固定队约定打断宏与顺序，目标本层数 0 漏断关键读条。",
          "3. 减伤规划练习：在死亡时间点前后检查可用减伤，制定「关键机制前 3 秒预开减伤」的习惯。",
        );
        break;
      default:
        lines.push("（本章暂无内容）");
    }
    const text = lines.join("\n");
    // 输出封顶（模拟真实输出上限约束）
    const capChars = (opts.maxTokens ?? 1800) * 3;
    return text.length > capChars ? text.slice(0, capChars) : text;
  }

  /** mock 问答：基于结构化数据 + 关键词给出带时间戳证据的确定性回答（T7）。 */
  private generateQaAnswer(user: string, opts: ChatOptions): string {
    const qMatch = /玩家问题：([\s\S]*)$/.exec(user);
    const question = (qMatch ? qMatch[1] : user).trim();

    let log: {
      combat?: { dungeon?: string; level?: number; durationSec?: number; success?: boolean; playerName?: string };
      aggregate?: {
        interrupts?: { t: number; spell?: string; actor?: string }[];
        deaths?: { t: number; actor?: string }[];
        cooldowns?: { t: number; spell?: string; note?: string; actor?: string }[];
        vulnerablePhases?: { start: number; end: number; note?: string }[];
        movement?: { t: number; spell?: string }[];
      };
    } = {};
    const jsonMatch = /```json\n([\s\S]*?)\n```/.exec(user);
    if (jsonMatch) {
      try {
        log = JSON.parse(jsonMatch[1]) as typeof log;
      } catch {
        // 忽略
      }
    }
    const agg = log.aggregate ?? {};
    const combat = log.combat ?? {};
    const verdicts = runIntentEngine({
      combat: {
        durationSec: combat.durationSec ?? 0,
        dungeon: combat.dungeon ?? "",
        level: combat.level ?? 0,
        playerName: combat.playerName ?? "",
      },
      aggregate: {
        cooldowns: agg.cooldowns ?? [],
        vulnerablePhases: agg.vulnerablePhases ?? [],
        deaths: agg.deaths ?? [],
        interrupts: agg.interrupts ?? [],
        movement: agg.movement ?? [],
      },
    });

    const q = question.toLowerCase();
    let answer: string;

    if (/上分|3000|冲层|分数|io分|整体提升/.test(q) && !/本场|这场/.test(q)) {
      answer =
        `基于本场数据（${combat.dungeon ?? "本场"} ${combat.level ?? ""} 层）：` +
        `先把第 4 章的可改进点逐条解决，再按第 6 章建议做 1–3 次针对性练习，通常比盲目冲层更有效。` +
        `（此为通用建议，不是基于本场数据；跨场综合分析将在后续版本提供。）`;
    } else if (/爆发|cd|伤害低|打低|输出/.test(q)) {
      const bursts = agg.cooldowns?.filter((c) => (c.note ?? "").includes("获得增益")) ?? [];
      const intents = verdicts.filter((v) => v.verdict === "intent");
      if (bursts.length === 0) {
        answer = `本场记录到的爆发/CD 事件较少（${fmt(0)} 起无爆发增益记录），难以从本场数据定位爆发问题；建议检查是否漏开爆发。`;
      } else {
        const refs = bursts.slice(0, 4).map((b) => `${fmt(b.t)} ${b.spell}`).join("、");
        const intentNote = intents.length
          ? ` 其中 ${intents.slice(0, 2).map((v) => v.explain).join("；")}`
          : "";
        answer =
          `从本场数据看，你的爆发时间点为 ${refs}。${intentNote || "爆发期间应保持技能循环不间断（证据见本场时间线）。"}`;
      }
    } else if (/死|减员|生存/.test(q)) {
      const deaths = agg.deaths ?? [];
      if (deaths.length === 0) {
        answer = "本场未记录到玩家死亡，生存表现没有明显问题。";
      } else {
        answer =
          `本场死亡记录：${deaths.map((d) => `${fmt(d.t)} ${d.actor ?? ""}`).join("；")}。` +
          `建议对照这些时间点检查减伤覆盖与治疗资源（本场减伤使用：${(agg.cooldowns ?? []).filter((c) => (c.note ?? "").includes("减伤")).map((c) => `${fmt(c.t)} ${c.spell}`).join("、") || "无记录"}）。`;
      }
    } else if (/打断|漏断/.test(q)) {
      const interrupts = agg.interrupts ?? [];
      answer = interrupts.length
        ? `本场打断共 ${interrupts.length} 次：${interrupts.map((i) => `${fmt(i.t)} ${i.spell ?? ""}`).join("、")}。可对照队伍分工检查是否存在漏断。`
        : "本场未记录到打断事件，存在漏断风险，建议约定打断分工（此为通用建议，不是基于本场数据）。";
    } else if (/药水|potion/.test(q)) {
      const potions = agg.cooldowns?.filter((c) => (c.spell ?? "").toLowerCase().includes("potion")) ?? [];
      answer = potions.length
        ? `本场药水使用：${potions.map((p) => `${fmt(p.t)} ${p.spell}（${p.note ?? ""}）`).join("；")}。`
        : "本场未记录到药水使用。";
    } else {
      const c = agg.cooldowns ?? [];
      answer =
        `本场关键数据（${combat.dungeon ?? ""} ${combat.level ?? ""} 层）：打断 ${agg.interrupts?.length ?? 0} 次，` +
        `死亡 ${agg.deaths?.length ?? 0} 次，爆发/CD ${c.length} 次，易伤窗口 ${agg.vulnerablePhases?.length ?? 0} 个。` +
        `针对你问的「${question.slice(0, 30)}」，请参考以上数据结合第 4/5 章复盘结论；如需更具体的点，请补充时间点或技能名。`;
    }

    const capChars = (opts.maxTokens ?? 1200) * 3;
    return answer.length > capChars ? answer.slice(0, capChars) : answer;
  }
}

// ---------- 工厂 ----------

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  // 生产 fail-fast：缺 DeepSeek 密钥直接抛错，禁止静默回退 mock 生成（M-2）
  requireProductionEnv("DEEPSEEK_API_KEY");
  cached = envConfig.deepseekApiKey ? new DeepSeekProvider() : new MockAiProvider();
  return cached;
}

/** 测试用：重置 provider 缓存。 */
export function resetAiProviderForTest(): void {
  cached = null;
}
