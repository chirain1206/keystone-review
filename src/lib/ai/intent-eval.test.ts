// QA 评测测试：复刻 eval/intent-eval.ts 的"规则引擎基线"评测逻辑。
// 原脚本依赖 tsx 运行（沙箱禁止子进程），此测试经 vitest 运行等价逻辑。
// 真实模型评测（DEEPSEEK_API_KEY 配置后）仍用 `npm run eval:intent`（阶段 5）。
import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { envConfig } from "@/lib/env";
import { runIntentEngine } from "@/lib/ai/intent-engine";

const THRESHOLD = 0.8;

interface Sample {
  id: string;
  title: string;
  verdict: "intent" | "mistake";
  expectedKey: string;
  combat: { dungeon: string; level: number; durationSec: number; playerName: string };
  aggregate: Record<string, unknown[]>;
}

describe("FR-5 意图识别样例集评测（规则引擎基线）", () => {
  it("样例集 ≥10 条，且正确率 ≥80%", async () => {
    const file = path.join(process.cwd(), "eval", "intent-samples.json");
    const raw = await fs.readFile(file, "utf8");
    const { samples } = JSON.parse(raw) as { samples: Sample[] };

    expect(samples.length).toBeGreaterThanOrEqual(10);
    // 基线评测不得依赖真实模型密钥（真实模型路径在阶段 5 跑）
    expect(envConfig.deepseekApiKey).toBeFalsy();

    let correct = 0;
    const failures: string[] = [];
    for (const s of samples) {
      const detected = runIntentEngine({ combat: s.combat, aggregate: s.aggregate as never });
      const hit = detected.some((d) => d.key === s.expectedKey && d.verdict === s.verdict);
      if (hit) correct++;
      else
        failures.push(
          `[${s.id}] ${s.title}：期望 ${s.expectedKey}/${s.verdict}，实得 ${detected
            .map((d) => `${d.key}:${d.verdict}`)
            .join(", ") || "无"}`,
        );
    }

    const accuracy = correct / samples.length;
    expect(
      accuracy,
      `正确率 ${correct}/${samples.length} = ${(accuracy * 100).toFixed(1)}%，未达 ${THRESHOLD * 100}%\n${failures.join("\n")}`,
    ).toBeGreaterThanOrEqual(THRESHOLD);
  });
});
