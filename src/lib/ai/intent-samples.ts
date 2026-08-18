import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * FR-5 样例集加载器（T6）。
 * JSON 文件位于 eval/intent-samples.json（QA 阶段直接消费同一文件）。
 * 用 fs 读取以兼容 vitest / tsx / Next 打包。
 */
export interface Sample {
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

const SAMPLES_FILE = path.join(process.cwd(), "eval", "intent-samples.json");

export function loadIntentSamples(): Sample[] {
  const raw = readFileSync(SAMPLES_FILE, "utf8");
  const parsed = JSON.parse(raw) as { samples: Sample[] };
  return parsed.samples;
}
