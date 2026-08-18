import { getAiProvider } from "@/lib/ai/provider";
import {
  buildChapterSystemPrompt,
  buildChapterUserMessage,
  CHAPTER_OUTPUT_TOKEN_CAP,
} from "@/lib/ai/prompts";
import { estimateTokens } from "@/lib/ai/tokens";
import { getRepo } from "@/lib/db";
import { CHAPTER_COUNT, CHAPTER_TITLES, type Report, type ReportChapter } from "@/lib/db/types";
import type { ProcessedLog } from "@/lib/parser/schema";

/**
 * 复盘生成管线（T5，FR-4 / ADR-001）。
 *  - 6 章并行调用 AI（Promise.all），单章输出封顶 1800 token
 *  - 每章独立存储（upsert，幂等）：已 done 的章节重跑时跳过（断点重试）
 *  - 失败章节状态 failed，可经单章接口单独重试
 *  - 指数退避重试 ×3（限流/网络类错误）
 *  - token 用量与成本写入章节记录（可观测性）
 */

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 800;

export interface GenerateCallbacks {
  onStatus?: (chapterNo: number, status: ReportChapter["status"]) => void;
  onDelta?: (chapterNo: number, delta: string) => void;
}

export interface GenerateResult {
  report: Report | null;
  chapters: ReportChapter[];
}

/** 单章生成（含重试）。返回最终章节记录。 */
async function generateChapter(
  userId: string,
  report: Report,
  chapterNo: number,
  log: ProcessedLog,
  cb?: GenerateCallbacks,
): Promise<ReportChapter> {
  const repo = getRepo();
  const title = CHAPTER_TITLES[chapterNo - 1];
  const markRunning = () =>
    repo.upsertChapter({
      reportId: report.id,
      chapterNo,
      title,
      content: "",
      status: "running",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    });

  // 无对比链接时第 3 章直接置空完成（FR-3：未粘贴则不显示该章节）
  if (chapterNo === 3 && !report.compareMeta) {
    cb?.onStatus?.(chapterNo, "running");
    const ch = await repo.upsertChapter({
      reportId: report.id,
      chapterNo,
      title,
      content: "",
      status: "done",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    });
    cb?.onStatus?.(chapterNo, "done");
    return ch;
  }

  await markRunning();
  cb?.onStatus?.(chapterNo, "running");

  const system = buildChapterSystemPrompt(chapterNo);
  let user = buildChapterUserMessage(chapterNo, log);
  if (chapterNo === 3 && report.compareMeta) {
    user += `\n\n对比基准（顶尖玩家本场数据）：\n${JSON.stringify(report.compareMeta)}`;
  }

  const ai = getAiProvider();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await ai.chat(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { maxTokens: CHAPTER_OUTPUT_TOKEN_CAP, temperature: 0.4 },
        { onDelta: (d) => cb?.onDelta?.(chapterNo, d) },
      );

      // 输出封顶（双保险：模型 maxTokens + 本地硬截断）
      const capChars = CHAPTER_OUTPUT_TOKEN_CAP * 3;
      const content =
        result.content.length > capChars ? result.content.slice(0, capChars) : result.content;

      const chapter = await repo.upsertChapter({
        reportId: report.id,
        chapterNo,
        title,
        content,
        status: "done",
        tokensIn: result.tokensIn,
        tokensOut: Math.max(result.tokensOut, estimateTokens(content)),
        costUsd: result.costUsd,
      });
      cb?.onStatus?.(chapterNo, "done");
      return chapter;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        // 指数退避（限流/网络类可重试；内容违规类 4xx 不重试）
        const backoff = RETRY_BASE_MS * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  const failed = await repo.upsertChapter({
    reportId: report.id,
    chapterNo,
    title,
    content: "",
    status: "failed",
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  });
  cb?.onStatus?.(chapterNo, "failed");
  console.error(`[report] 章节 ${chapterNo} 生成失败（report=${report.id}）:`, lastError?.message);
  return failed;
}

/** 主入口：并行生成 6 章（已 done 的章节幂等跳过）。 */
export async function generateReport(
  userId: string,
  reportId: string,
  cb?: GenerateCallbacks,
): Promise<GenerateResult> {
  const repo = getRepo();
  const report = await repo.getReport(userId, reportId);
  if (!report) return { report: null, chapters: [] };
  const logRecord = await repo.getProcessedLog(userId, reportId);
  if (!logRecord) {
    throw new Error("该复盘缺少结构化数据，无法生成报告");
  }

  await repo.updateReportStatus(reportId, "generating");

  const existing = await repo.getChapters(userId, reportId);
  const doneSet = new Set(
    existing.filter((c) => c.status === "done").map((c) => c.chapterNo),
  );

  // 并行生成所有未完成的章节
  await Promise.all(
    Array.from({ length: CHAPTER_COUNT }, (_, i) => i + 1)
      .filter((n) => !doneSet.has(n))
      .map((n) => generateChapter(userId, report, n, logRecord.log, cb)),
  );

  const chapters = await repo.getChapters(userId, reportId);
  const allDone = chapters.length === CHAPTER_COUNT && chapters.every((c) => c.status === "done");
  const hasFailed = chapters.some((c) => c.status === "failed");
  const finalStatus: Report["status"] = allDone ? "ready" : hasFailed ? "failed" : "generating";
  await repo.updateReportStatus(reportId, finalStatus);

  return { report: await repo.getReport(userId, reportId), chapters };
}

/** 单章重试入口（T5：某章失败只重跑该章）。 */
export async function regenerateChapter(
  userId: string,
  reportId: string,
  chapterNo: number,
  cb?: GenerateCallbacks,
): Promise<ReportChapter | null> {
  const repo = getRepo();
  const report = await repo.getReport(userId, reportId);
  if (!report) return null;
  const logRecord = await repo.getProcessedLog(userId, reportId);
  if (!logRecord) throw new Error("该复盘缺少结构化数据");

  const chapter = await generateChapter(userId, report, chapterNo, logRecord.log, cb);

  // 若全部章节都已 done，报告状态升为 ready
  const chapters = await repo.getChapters(userId, reportId);
  if (chapters.length === CHAPTER_COUNT && chapters.every((c) => c.status === "done")) {
    await repo.updateReportStatus(reportId, "ready");
  } else if (chapters.some((c) => c.status === "failed")) {
    await repo.updateReportStatus(reportId, "failed");
  }
  return chapter;
}
