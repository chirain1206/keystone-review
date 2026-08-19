import { envConfig } from "@/lib/env";
import { getAiProvider } from "@/lib/ai/provider";
import { getAllTerms } from "@/lib/kb/term-dict";

/**
 * DeepSeek 提炼适配器：把（已术语纠错后的）视频转写稿提炼成 kb/sources 一致的
 * markdown 正文。提示词要求：只提炼视频讲过的、技能名用术语词典标准名、结构
 * 与 kb/sources 一致、≤15 条。
 */

export interface ExtractionContext {
  title: string;
  cls: string;
  spec: string;
  patch: string;
  up?: string;
  /** 已格式化的同职业已有知识（无则空串）。 */
  existingKnowledge: string;
}

/** 渲染标准名词汇表（提示词中约束模型用标准名）。 */
export function renderGlossary(): string {
  return getAllTerms()
    .map((t) => t.standard)
    .filter(Boolean)
    .join("、");
}

/** 构造提炼提示词（纯函数，供测试断言提示词要点）。 */
export function buildExtractionPrompt(ctx: ExtractionContext, transcript: string): {
  system: string;
  user: string;
} {
  const system =
    "你是《魔兽世界》大秘境攻略整理助手，负责把视频转写稿提炼成可入库的手法要点。";
  const user = [
    `【视频标题】${ctx.title}`,
    `【职业/专精】${ctx.cls} / ${ctx.spec}`,
    `【版本补丁】${ctx.patch}`,
    ctx.up ? `【作者/UP主】${ctx.up}` : "",
    "",
    "【硬性要求】",
    "1. 只提炼视频里真实讲过的内容，不得编造、不得补充视频没有的观点。",
    "2. 技能/天赋名一律使用下面这份「标准名」里的写法（即使转写稿里是简称或错字，也必须统一成标准名，不得写回简称/错字）：",
    renderGlossary(),
    "3. 输出与知识库源文件一致的 markdown 结构：开头一行 `# 标题`，之后用 `## 小节名` 分组（如 核心机制 / 爆发手法 / 平稳期 / 天赋与配装），每条要点独立一行，形如 `- 【要点名】说明。（适用：单体 / AOE / 通用）`。",
    "4. 总要点数不超过 15 条。",
    "5. 下面【已有知识】是同一职业的既有攻略，仅供参照写法与口径，不要照抄其内容。",
    "",
    "【已有知识（仅供参照）】",
    ctx.existingKnowledge || "（无已有知识）",
    "",
    "【转写稿正文】",
    transcript,
    "",
    "请直接输出整理后的 markdown 正文（不要 frontmatter、不要多余解释）。",
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

export interface ExtractionPrompt {
  system: string;
  user: string;
}

/** 真实提炼：走 DeepSeek（无密钥时抛错，禁止静默 mock 产出）。 */
export async function extractKnowledge(prompt: ExtractionPrompt): Promise<string> {
  if (!envConfig.deepseekApiKey) {
    throw new Error("未配置 DEEPSEEK_API_KEY，无法提炼视频要点；请配置后重试");
  }
  const provider = getAiProvider();
  const result = await provider.chat(
    [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    { temperature: 0.2, maxTokens: 3200 },
  );
  const content = result.content.trim();
  if (!content) throw new Error("提炼结果为空，请重试");
  return content;
}
