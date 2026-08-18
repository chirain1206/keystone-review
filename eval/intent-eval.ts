/**
 * FR-5 战术意图识别评测脚本（T6 + FR-11/T19 双模式，T17 扩展）。
 * 用法：npm run eval:intent
 *  - 无 DEEPSEEK_API_KEY：确定性引擎（规则 + 知识辅助 + 疑似技巧）
 *  - 配置 DEEPSEEK_API_KEY：真实模型按第 5 章提示词批量判定（QA 阶段 ≥80% 放行）
 * 双模式对比：
 *   A 无检索（不注入知识）→ 领域知识依赖型案例应无法识别
 *   B 有检索（注入 kbFixtures）→ 知识依赖型案例正确率 ≥80%
 * 通过标准：模式 B 知识依赖样例 ≥80% 且模式 A 非知识依赖样例 ≥80%，否则退出码 1。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { envConfig } from "@/lib/env";
import {
  runIntentEngine,
  runKnowledgeIntentDetection,
  runSuspectedTechniqueDetection,
} from "@/lib/ai/intent-engine";
import { buildChapterSystemPrompt } from "@/lib/ai/prompts";
import { getAiProvider } from "@/lib/ai/provider";

interface Sample {
  id: string;
  title: string;
  verdict: "intent" | "mistake" | "suspected";
  expectedKey: string;
  kbFixtures?: string[];
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

function detectWithEngine(s: Sample, withKnowledge: boolean) {
  const input = { combat: s.combat, aggregate: s.aggregate };
  const knowledge = withKnowledge
    ? runKnowledgeIntentDetection(input, s.kbFixtures ?? [])
    : [];
  const engine = runIntentEngine(input);
  const suspected = runSuspectedTechniqueDetection(input, knowledge);
  return [...engine, ...knowledge, ...suspected].map((v) => ({ key: v.key, verdict: v.verdict }));
}

async function main(): Promise<number> {
  const file = path.join(process.cwd(), "eval", "intent-samples.json");
  const raw = await fs.readFile(file, "utf8");
  const { samples } = JSON.parse(raw) as { samples: Sample[] };
  const kbDependent = samples.filter((s) => (s.kbFixtures?.length ?? 0) > 0);
  const others = samples.filter((s) => (s.kbFixtures?.length ?? 0) === 0);
  console.log(
    `样例集共 ${samples.length} 条（知识依赖 ${kbDependent.length} / 其他 ${others.length}），通过阈值 ${THRESHOLD * 100}%\n`,
  );

  const useRealModel = Boolean(envConfig.deepseekApiKey);
  console.log(useRealModel ? "评测后端：DeepSeek 真实模型" : "评测后端：确定性引擎（规则+知识辅助+疑似技巧）\n");

  const run = async (list: Sample[], withKnowledge: boolean, label: string) => {
    let correct = 0;
    for (const s of list) {
      const detected = useRealModel
        ? await evaluateWithRealModel(s, withKnowledge)
        : detectWithEngine(s, withKnowledge);
      const hit = detected.some((d) => d.key === s.expectedKey && d.verdict === s.verdict);
      const extra = detected.filter((d) => d.key !== s.expectedKey).map((d) => d.key);
      if (hit) correct++;
      console.log(
        `${hit ? "✅" : "❌"} [${label}][${s.id}] ${s.verdict === "intent" ? "意图" : s.verdict === "suspected" ? "疑似" : "失误"} ${s.title}` +
          (hit ? "" : `（期望 ${s.expectedKey}/${s.verdict}，实得 ${detected.map((d) => `${d.key}:${d.verdict}`).join(", ") || "无"}）`) +
          (extra.length ? `（额外命中：${extra.join(",")}）` : ""),
      );
    }
    const accuracy = correct / list.length;
    console.log(`[${label}] 正确率：${correct}/${list.length} = ${(accuracy * 100).toFixed(1)}%\n`);
    return accuracy;
  };

  // 模式 A：无检索（非知识依赖样例）
  const accA = await run(others, false, "A 无检索");
  // 模式 B：有检索（知识依赖样例注入 kbFixtures）
  const accB = await run(kbDependent, true, "B 有检索");
  // 对比行：知识依赖样例在无检索下的表现（体现注入价值）
  const accAonKb = await run(kbDependent, false, "A→B 对比（知识依赖样例无检索）");

  console.log("模式对比：");
  console.log(`  无检索（非知识依赖）：${(accA * 100).toFixed(1)}%`);
  console.log(`  无检索（知识依赖）：  ${(accAonKb * 100).toFixed(1)}%  ← 缺知识无法识别`);
  console.log(`  有检索（知识依赖）：  ${(accB * 100).toFixed(1)}%  ← 注入知识后识别`);

  if (accA >= THRESHOLD && accB >= THRESHOLD) {
    console.log(`通过（两口径均 ≥${THRESHOLD * 100}%）`);
    return 0;
  }
  console.error(`不通过（<${THRESHOLD * 100}%），需要调整意图判定提示词/规则`);
  return 1;
}

/** 真实模型评测：第 5 章提示词 + 样例数据（+可选知识）→ 结构化判定结果。 */
async function evaluateWithRealModel(
  s: Sample,
  withKnowledge: boolean,
): Promise<{ key: string; verdict: string }[]> {
  const ai = getAiProvider();
  const system = buildChapterSystemPrompt(5);
  const kbBlock = withKnowledge && s.kbFixtures?.length
    ? `【社区攻略参考】以下内容仅供参考，不代表本场数据。\n${s.kbFixtures.join("\n")}\n【/社区攻略参考】\n`
    : "";
  const user =
    `请对以下"可疑操作"做战术意图判定，输出 JSON 数组（无则输出 []）：\n` +
    `[{"key":"模式英文标识","verdict":"intent|mistake|suspected","explain":"中文解释"}]。\n` +
    `模式标识必须从以下集合选择：potion-align-vulnerable, hold-burst-for-vuln, ` +
    `defensive-before-phase, pre-defensive-no-death, interrupt-chain, burst-only-in-vuln, ` +
    `kite-before-phase, burst-at-phase-start, resource-pooling, potion-window-covers-vuln, ` +
    `wasted-burst, potion-wasted, death-in-vuln, burst-overlap, zero-interrupts, potion-at-fight-end, ` +
    `gather-before-burst, hold-burst-next-vuln, quiet-resource-window, late-interrupt-by-design, ` +
    `pet-position-evade, pet-preposition-before-phase。\n` +
    `${kbBlock}` +
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
