/**
 * FR-5 战术意图识别评测脚本（T6）。
 * 用法：npm run eval:intent
 *  - 无 DEEPSEEK_API_KEY：用确定性规则引擎（intent-engine）跑全部样例
 *    （开发自测基线，应 100% 通过）
 *  - 配置 DEEPSEEK_API_KEY：用真实模型按第 5 章提示词批量判定
 *    （QA 阶段验收：意图识别正确率 ≥80% 才放行）
 * 通过标准：正确判定数 / 总样例数 ≥ 0.8，否则退出码 1。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { envConfig } from "@/lib/env";
import { runIntentEngine } from "@/lib/ai/intent-engine";
import { buildChapterSystemPrompt } from "@/lib/ai/prompts";
import { getAiProvider } from "@/lib/ai/provider";

interface Sample {
  id: string;
  title: string;
  verdict: "intent" | "mistake";
  expectedKey: string;
  combat: { dungeon: string; level: number; durationSec: number; playerName: string };
  aggregate: {
    cooldowns: { t: number; spell?: string; note?: string; actor?: string }[];
    vulnerablePhases: { start: number; end: number; note?: string }[];
    deaths: { t: number; actor?: string }[];
    interrupts: { t: number; spell?: string; actor?: string }[];
    movement: { t: number; spell?: string; actor?: string }[];
  };
}

const THRESHOLD = 0.8;

async function main(): Promise<number> {
  const file = path.join(process.cwd(), "eval", "intent-samples.json");
  const raw = await fs.readFile(file, "utf8");
  const { samples } = JSON.parse(raw) as { samples: Sample[] };
  console.log(`样例集共 ${samples.length} 条（意图 ${samples.filter((s) => s.verdict === "intent").length} / 失误 ${samples.filter((s) => s.verdict === "mistake").length}），通过阈值 ${THRESHOLD * 100}%\n`);

  const useRealModel = Boolean(envConfig.deepseekApiKey);
  console.log(useRealModel ? "评测后端：DeepSeek 真实模型" : "评测后端：确定性规则引擎（开发自测基线）\n");

  let correct = 0;
  for (const s of samples) {
    const detected = useRealModel
      ? await evaluateWithRealModel(s)
      : runIntentEngine({ combat: s.combat, aggregate: s.aggregate })
          .map((v) => ({ key: v.key, verdict: v.verdict }));

    const hit = detected.some((d) => d.key === s.expectedKey && d.verdict === s.verdict);
    const extra = detected.filter((d) => d.key !== s.expectedKey).map((d) => d.key);
    if (hit) correct++;
    console.log(
      `${hit ? "✅" : "❌"} [${s.id}] ${s.verdict === "intent" ? "意图" : "失误"} ${s.title}` +
        (hit ? "" : `（期望 ${s.expectedKey}/${s.verdict}，实得 ${detected.map((d) => `${d.key}:${d.verdict}`).join(", ") || "无"}）`) +
        (extra.length ? `（额外命中：${extra.join(",")}）` : ""),
    );
  }

  const accuracy = correct / samples.length;
  console.log(`\n正确率：${correct}/${samples.length} = ${(accuracy * 100).toFixed(1)}%`);
  if (accuracy >= THRESHOLD) {
    console.log(`通过（≥${THRESHOLD * 100}%）`);
    return 0;
  }
  console.error(`不通过（<${THRESHOLD * 100}%），需要调整意图判定提示词/规则`);
  return 1;
}

/** 真实模型评测：第 5 章提示词 + 样例数据 → 请求结构化判定结果。 */
async function evaluateWithRealModel(s: Sample): Promise<{ key: string; verdict: string }[]> {
  const ai = getAiProvider();
  const system = buildChapterSystemPrompt(5);
  const user =
    `请对以下"可疑操作"做战术意图判定，输出 JSON 数组（无则输出 []）：\n` +
    `[{"key":"模式英文标识","verdict":"intent|mistake","explain":"中文解释"}]。\n` +
    `模式标识必须从以下集合选择：potion-align-vulnerable, hold-burst-for-vuln, ` +
    `defensive-before-phase, pre-defensive-no-death, interrupt-chain, burst-only-in-vuln, ` +
    `kite-before-phase, burst-at-phase-start, resource-pooling, potion-window-covers-vuln, ` +
    `wasted-burst, potion-wasted, death-in-vuln, burst-overlap, zero-interrupts, potion-at-fight-end。\n` +
    `本场数据：\n\`\`\`json\n${JSON.stringify({ combat: s.combat, aggregate: s.aggregate })}\n\`\`\``;
  const r = await ai.chat([{ role: "system", content: system }, { role: "user", content: user }], {
    maxTokens: 1200,
  });
  const m = /\[[\s\S]*\]/.exec(r.content);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]) as { key: string; verdict: string }[];
    return arr.filter((x) => typeof x.key === "string");
  } catch {
    return [];
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
