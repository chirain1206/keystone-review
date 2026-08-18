import { envConfig } from "@/lib/env";
import { estimateTokens } from "@/lib/ai/tokens";

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
      throw new Error(`DeepSeek API ${res.status}: ${body.slice(0, 300)}`);
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

interface MockIntentCase {
  key: string;
  explain: string;
}

/**
 * FR-5 规则样例（T5 先行内置 2 例，T6 扩展为完整样例集 + 评测脚本）：
 * 对"看似失误实为正确决策"的关键模式做确定性判定。
 */
export function detectIntentCases(log: {
  aggregate: {
    cooldowns: { t: number; spell?: string; actor?: string; note?: string }[];
    vulnerablePhases: { start: number; end: number; note?: string }[];
    deaths: { t: number; actor?: string }[];
    interrupts: { t: number; spell?: string }[];
  };
}): MockIntentCase[] {
  const cases: MockIntentCase[] = [];
  const { cooldowns, vulnerablePhases, deaths, interrupts } = log.aggregate;

  // 案例 1：无爆发窗口喝爆发药水，但 300±15s 后存在易伤阶段 → 对齐易伤的意图决策
  // 只取"使用药水"的施放事件（AURA 获得/结束为同一瓶药水的伴随事件，不重复判定）
  const potions = cooldowns.filter(
    (c) => c.spell?.toLowerCase().includes("potion") && (c.note ?? "").includes("药水"),
  );
  const majorBursts = cooldowns.filter(
    (c) => !c.spell?.toLowerCase().includes("potion") && (c.note ?? "").includes("获得增益"),
  );
  for (const p of potions) {
    const nearBurst = majorBursts.some((b) => Math.abs(b.t - p.t) <= 25);
    const alignsVuln = vulnerablePhases.some(
      (v) => v.start - p.t >= 240 && v.start - p.t <= 360,
    );
    if (!nearBurst && alignsVuln) {
      const v = vulnerablePhases.find((x) => x.start - p.t >= 240 && x.start - p.t <= 360)!;
      cases.push({
        key: "potion-align-vulnerable",
        explain: `在 ${fmt(p.t)} 无爆发增益时使用 ${p.spell}，看似浪费：但本场 ${fmt(v.start)} 起存在 BOSS 易伤阶段（${v.note ?? "易伤"}），药水 30 秒增益窗口覆盖该阶段，属于"留资源对齐易伤"的意图决策，判断为正确操作。`,
      });
    }
  }

  // 案例 2：易伤阶段前 8 秒内（±2s 容差）开启爆发 → 留爆发的意图决策
  for (const b of majorBursts) {
    const rightBefore = vulnerablePhases.some(
      (v) => v.start - b.t >= -2 && v.start - b.t <= 8,
    );
    if (rightBefore) {
      cases.push({
        key: "hold-burst-for-vuln",
        explain: `在 ${fmt(b.t)} 开启 ${b.spell ?? "爆发技能"}，紧贴易伤阶段开启时间：这是把爆发对齐易伤窗口的规划，判断为正确决策。`,
      });
    }
  }

  // 真实失误样例：爆发开启后 15 秒内无任何施放记录且无死亡/打断 → 空转
  for (const b of majorBursts) {
    const castsNear = cooldowns.some(
      (c) => c !== b && Math.abs(c.t - b.t) <= 15 && c.spell !== b.spell,
    );
    const diedNear = deaths.some((d) => d.t >= b.t && d.t <= b.t + 15);
    if (!castsNear && !diedNear && majorBursts.length === 1) {
      cases.push({
        key: "wasted-burst",
        explain: `${fmt(b.t)} 开启 ${b.spell ?? "爆发"} 后 15 秒内无其他技能记录，疑似爆发期空转，应列入"可改进点"。`,
      });
    }
  }

  void interrupts;
  return cases;
}

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
    const chapterMatch = /【章节(\d)】/.exec(system) ?? /章节(\d)/.exec(system);
    const chapterNo = chapterMatch ? Number(chapterMatch[1]) : 1;

    // 从 user 内容提取结构化数据（管线注入的 JSON 片段）
    let log: { combat?: { dungeon?: string; level?: number; playerName?: string; playerClass?: string; success?: boolean; durationSec?: number }; aggregate?: { interrupts?: { t: number; spell?: string }[]; deaths?: { t: number; actor?: string }[]; cooldowns?: { t: number; spell?: string; note?: string; actor?: string }[]; vulnerablePhases?: { start: number; end: number; note?: string }[]; perMinute?: { damage?: number; heal?: number }[] } } = {};
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

    const intentCases = detectIntentCases({ aggregate: agg as never });

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
      case 4:
        lines.push("可改进点清单：");
        if (deaths.length > 0) {
          lines.push(
            `1. 现象：战斗中期出现玩家死亡。证据：${deaths.map((d) => `${fmt(d.t)} ${d.actor ?? ""} 死亡`).join("；")}。建议：复盘该时间点减伤覆盖与治疗资源规划，避免关键机制期减员。`,
          );
        }
        if (intentCases.some((c) => c.key === "wasted-burst")) {
          lines.push(
            `2. 现象：爆发期空转。证据：${intentCases.find((c) => c.key === "wasted-burst")!.explain} 建议：爆发前确认目标存活与资源到位，爆发期内保持技能循环不间断。`,
          );
        }
        if (interrupts.length < 2) {
          lines.push(
            "3. 现象：本场打断次数偏低。证据：全场仅记录到少量打断事件。建议：与队伍约定打断分工，优先打断高危读条（如治疗类与群控类技能）。",
          );
        }
        if (lines.length === 1) {
          lines.push("1. 未发现明显的可改进点，保持现有节奏，可关注爆发对齐的细节（见第 5 章）。");
        }
        break;
      case 5: {
        lines.push("战术意图识别：");
        const good = intentCases.filter((c) => c.key !== "wasted-burst");
        if (good.length > 0) {
          for (const c of good) lines.push(`- ✅ 正确决策：${c.explain}`);
        } else {
          lines.push("- 本场未发现「看似异常实为正确决策」的样本操作。");
        }
        const wasted = intentCases.filter((c) => c.key === "wasted-burst");
        if (wasted.length > 0) {
          lines.push(`- ⚠️ 真实失误：${wasted[0].explain}`);
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
}

// ---------- 工厂 ----------

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  cached = envConfig.deepseekApiKey ? new DeepSeekProvider() : new MockAiProvider();
  return cached;
}

/** 测试用：重置 provider 缓存。 */
export function resetAiProviderForTest(): void {
  cached = null;
}
