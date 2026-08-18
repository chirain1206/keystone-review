import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getRepo, resetRepoForTest } from "@/lib/db";
import { generateReport, regenerateChapter } from "@/lib/report/generate";
import { CHAPTER_OUTPUT_TOKEN_CAP, estimateProcessedLogTokens } from "@/lib/ai/tokens";
import { parseCombatLog, toProcessedLog } from "@/lib/parser/parser";
import { mplusSample } from "@/lib/parser/samples";
import { buildChapterUserMessage, sliceForChapter } from "@/lib/ai/prompts";

/**
 * T5 验收（FR-4）：
 *  - 6 章并行生成、章节独立存储
 *  - 幂等（重跑跳过已完成章节、不产生重复）
 *  - 单章重试
 *  - 每章输出 ≤1800 token
 *  - 章节级数据切片 + token 用量可观测
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-report-test-${Date.now()}`);

beforeAll(() => {
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  resetRepoForTest();
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(() => resetRepoForTest());

async function createTestReport(compareUrl?: string) {
  const repo = getRepo();
  const r = await repo.createReport({
    userId: "user-a",
    sourceType: "file",
    dungeon: "Mists of Tirna Scithe",
    level: 15,
    spec: "Fire",
    playerName: "Mymage",
    playerClass: "Mage",
    result: true,
    compareMeta: compareUrl ? { url: compareUrl } : null,
  });
  const parsed = parseCombatLog(mplusSample());
  const log = toProcessedLog(parsed.runs![0], "file");
  await repo.saveProcessedLog({
    reportId: r.id,
    log,
    rawSize: 100_000,
    rawLines: 5_000,
    tokenEstimate: estimateProcessedLogTokens(log),
  });
  return r;
}

describe("复盘生成管线（T5）", () => {
  it("生成 6 章、全部 done、报告 ready、章节内容带时间戳证据", async () => {
    const r = await createTestReport();
    const events: { chapterNo: number; status: string }[] = [];
    const result = await generateReport("user-a", r.id, {
      onStatus: (chapterNo, status) => events.push({ chapterNo, status }),
    });

    expect(result.report?.status).toBe("ready");
    expect(result.chapters.length).toBe(6);
    expect(result.chapters.every((c) => c.status === "done")).toBe(true);

    // 第 5 章含 FR-5 意图识别样例（5:36 药水对齐易伤）
    const ch5 = result.chapters.find((c) => c.chapterNo === 5)!;
    expect(ch5.content).toContain("正确决策");
    expect(ch5.content).toContain("5:36");

    // 第 1 章概览含副本与层数
    const ch1 = result.chapters.find((c) => c.chapterNo === 1)!;
    expect(ch1.content).toContain("Mists of Tirna Scithe");
    expect(ch1.content).toContain("15");

    // 状态事件齐备（每个生成章节 running→done）
    const doneEvents = events.filter((e) => e.status === "done");
    expect(doneEvents.length).toBe(6);
  });

  it("无对比链接：第 3 章为空且 done，其余章节不受影响", async () => {
    const r = await createTestReport();
    const result = await generateReport("user-a", r.id);
    const ch3 = result.chapters.find((c) => c.chapterNo === 3)!;
    expect(ch3.status).toBe("done");
    expect(ch3.content).toBe("");
    expect(result.chapters.filter((c) => c.status === "done").length).toBe(6);
  });

  it("幂等：重跑跳过已完成章节，章节行数不增加", async () => {
    const r = await createTestReport();
    await generateReport("user-a", r.id);
    const before = await getRepo().getChapters("user-a", r.id);

    // 记录第 1 章内容，重跑后应不变（未被覆盖）
    const ch1Before = before.find((c) => c.chapterNo === 1)!.content;
    await generateReport("user-a", r.id);
    const after = await getRepo().getChapters("user-a", r.id);

    expect(after.length).toBe(6);
    expect(after.find((c) => c.chapterNo === 1)!.content).toBe(ch1Before);
  });

  it("单章重试：failed 章节经 regenerateChapter 变为 done", async () => {
    const r = await createTestReport();
    await generateReport("user-a", r.id);
    // 手动把第 2 章标记为 failed（模拟某章失败场景）
    await getRepo().upsertChapter({
      reportId: r.id,
      chapterNo: 2,
      title: "关键时机分析",
      content: "",
      status: "failed",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    });

    const ch = await regenerateChapter("user-a", r.id, 2);
    expect(ch?.status).toBe("done");
    expect(ch!.content.length).toBeGreaterThan(0);
    const report = await getRepo().getReport("user-a", r.id);
    expect(report?.status).toBe("ready");
  });

  it("每章输出 ≤1800 token（约 5400 字符）", async () => {
    const r = await createTestReport();
    const result = await generateReport("user-a", r.id);
    for (const c of result.chapters) {
      const chars = c.content.length;
      expect(chars).toBeLessThanOrEqual(CHAPTER_OUTPUT_TOKEN_CAP * 3);
    }
  });

  it("章节数据切片：各章只含相关片段且不超预算", async () => {
    const parsed = parseCombatLog(mplusSample());
    const log = toProcessedLog(parsed.runs![0], "file");
    for (let n = 1; n <= 6; n++) {
      const msg = buildChapterUserMessage(n, log);
      const tokens = estimateProcessedLogTokens({ msg });
      expect(tokens).toBeLessThanOrEqual(50_000);
    }
    // 第 2 章（时机分析）不含分钟聚合，第 4 章（可改进点）包含
    expect(sliceForChapter(2, log)).not.toContain("分钟级输出");
    expect(sliceForChapter(4, log)).toContain("分钟级输出");
  });

  it("属主校验：他人无法生成我的报告", async () => {
    const r = await createTestReport();
    const result = await generateReport("user-b", r.id);
    expect(result.report).toBeNull();
    expect(result.chapters.length).toBe(0);
  });
});
