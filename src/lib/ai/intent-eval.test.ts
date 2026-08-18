// QA 评测测试：复刻 eval/intent-eval.ts 的评测逻辑（含 FR-11/T19 双模式）。
// 原脚本依赖 tsx 运行（沙箱禁止子进程），此测试经 vitest 运行等价逻辑。
// 真实模型评测（DEEPSEEK_API_KEY 配置后）仍用 `npm run eval:intent`（阶段 5）。
import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { envConfig } from "@/lib/env";
import {
  runIntentEngine,
  runKnowledgeIntentDetection,
  runSuspectedTechniqueDetection,
} from "@/lib/ai/intent-engine";

const THRESHOLD = 0.8;

interface Sample {
  id: string;
  title: string;
  verdict: "intent" | "mistake" | "suspected";
  expectedKey: string;
  kbFixtures?: string[];
  combat: { dungeon: string; level: number; durationSec: number; playerName: string };
  aggregate: Record<string, unknown[]>;
}

function detect(s: Sample, withKnowledge: boolean) {
  const input = { combat: s.combat, aggregate: s.aggregate as never };
  const knowledge = withKnowledge
    ? runKnowledgeIntentDetection(input, s.kbFixtures ?? [])
    : [];
  const engine = runIntentEngine(input);
  const suspected = runSuspectedTechniqueDetection(input, knowledge);
  return [...engine, ...knowledge, ...suspected];
}

describe("FR-5/FR-11/T19 意图识别样例集评测（规则引擎基线，双模式）", () => {
  it("样例集达标，且两模式各有正确率口径", async () => {
    const file = path.join(process.cwd(), "eval", "intent-samples.json");
    const raw = await fs.readFile(file, "utf8");
    const { samples } = JSON.parse(raw) as { samples: Sample[] };

    expect(samples.length).toBeGreaterThanOrEqual(21);
    // 基线评测不得依赖真实模型密钥（真实模型路径在阶段 5 跑）
    expect(envConfig.deepseekApiKey).toBeFalsy();

    const kbDependent = samples.filter((s) => (s.kbFixtures?.length ?? 0) > 0);
    const others = samples.filter((s) => (s.kbFixtures?.length ?? 0) === 0);

    const run = (list: Sample[], withKnowledge: boolean) => {
      let correct = 0;
      const failures: string[] = [];
      for (const s of list) {
        const detected = detect(s, withKnowledge);
        const hit = detected.some((d) => d.key === s.expectedKey && d.verdict === s.verdict);
        if (hit) correct++;
        else
          failures.push(
            `[${s.id}] ${s.title}：期望 ${s.expectedKey}/${s.verdict}，实得 ${detected
              .map((d) => `${d.key}:${d.verdict}`)
              .join(", ") || "无"}`,
          );
      }
      return { correct, total: list.length, failures };
    };

    // 模式 A（无检索）：非知识依赖样例（含疑似案例）仍 ≥80%
    const modeA = run(others, false);
    const accA = modeA.correct / modeA.total;
    expect(
      accA,
      `无检索模式正确率 ${modeA.correct}/${modeA.total} = ${(accA * 100).toFixed(1)}%，未达 ${THRESHOLD * 100}%\n${modeA.failures.join("\n")}`,
    ).toBeGreaterThanOrEqual(THRESHOLD);

    // 模式 B（有检索）：知识依赖样例注入知识后 ≥80%（FR-11 验收）
    const modeB = run(kbDependent, true);
    const accB = modeB.correct / modeB.total;
    expect(
      accB,
      `知识注入模式正确率 ${modeB.correct}/${modeB.total} = ${(accB * 100).toFixed(1)}%，未达 ${THRESHOLD * 100}%\n${modeB.failures.join("\n")}`,
    ).toBeGreaterThanOrEqual(THRESHOLD);

    // 对比：知识依赖样例在无检索模式下不应命中期望意图（体现注入价值）
    const modeAonKb = run(kbDependent, false);
    expect(modeAonKb.correct).toBeLessThan(modeB.correct);

    // 疑似案例在任何模式下都判"疑似"而非"失误"（疑似事件时间窗内无失误判定）
    const suspected = samples.filter((s) => s.verdict === "suspected");
    expect(suspected.length).toBeGreaterThanOrEqual(1);
    for (const s of suspected) {
      const detected = detect(s, false);
      const hit = detected.find((d) => d.key === s.expectedKey && d.verdict === "suspected");
      expect(hit).toBeTruthy();
      const atSec = hit?.atSec ?? 0;
      const mistakesNear = detected.filter(
        (d) => d.verdict === "mistake" && d.atSec !== undefined && Math.abs(d.atSec - atSec) <= 30,
      );
      expect(mistakesNear).toEqual([]);
    }
  });
});
