import { getAiProvider } from "@/lib/ai/provider";
import {
  buildChapterSystemPrompt,
  buildChapterUserMessage,
  CHAPTER_OUTPUT_TOKEN_CAP,
} from "@/lib/ai/prompts";
import { estimateTokens } from "@/lib/ai/tokens";
import {
  runKnowledgeIntentDetection,
  runSuspectedTechniqueDetection,
  type IntentInput,
} from "@/lib/ai/intent-engine";
import { getRepo } from "@/lib/db";
import { CHAPTER_COUNT, CHAPTER_TITLES, type Report, type ReportChapter } from "@/lib/db/types";
import type { ProcessedLog } from "@/lib/parser/schema";
import { generateKbDelimiters, retrieveKnowledge } from "@/lib/kb/retrieval";
import { persistSuspectedCandidates } from "@/lib/kb/candidates";
import { localizeAbilityNames } from "@/lib/wcl/ability-zh-names";

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

/** 从结构化日志构造意图引擎输入（第 5 章知识辅助判定 + 疑似技巧检测共用）。 */
function intentInputFromLog(log: ProcessedLog): IntentInput {
  return {
    combat: {
      durationSec: log.combat.durationSec,
      dungeon: log.combat.dungeon,
      level: log.combat.level,
      playerName: log.combat.playerName,
    },
    aggregate: {
      cooldowns: log.aggregate.cooldowns,
      vulnerablePhases: log.aggregate.vulnerablePhases,
      deaths: log.aggregate.deaths,
      interrupts: log.aggregate.interrupts,
      movement: log.aggregate.movement,
    },
  };
}

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

  // FR-11：第 5 章检索注入社区知识（top-k≤5、随机定界包裹、来源标注；失败/未命中降级）。
  // 定界符先生成，system 提示词与数据区共用同一对随机 token（M-RAG-1 随机定界）。
  const kbDelims = chapterNo === 5 ? generateKbDelimiters() : undefined;
  const system = buildChapterSystemPrompt(chapterNo, kbDelims);
  let user = buildChapterUserMessage(chapterNo, log);
  if (chapterNo === 3 && report.compareMeta) {
    user += `\n\n对比基准（顶尖玩家本场数据）：\n${JSON.stringify(report.compareMeta)}`;
  }

  let kbTexts: string[] = [];
  if (chapterNo === 5) {
    try {
      const kb = await retrieveKnowledge(
        {
          playerClass: report.playerClass,
          playerSpec: report.spec,
          dungeon: report.dungeon,
          chapterNo: 5,
        },
        kbDelims,
      );
      if (kb) {
        user += `\n\n${kb.formatted}`;
        kbTexts = kb.hits.map((h) => h.chunkText);
      }
    } catch {
      // 降级：仅 log 证据分析（FR-11）
    }
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
      const rawContent =
        result.content.length > capChars ? result.content.slice(0, capChars) : result.content;
      // 报告正文展示本地化：技能/药水/增益英文原名 → "国服译名（英文原名）"
      const content = localizeAbilityNames(rawContent);

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

      // T19：第 5 章完成后，检测"疑似高阶技巧"并沉淀候选（幂等）
      if (chapterNo === 5) {
        try {
          const knowledgeVerdicts = runKnowledgeIntentDetection(
            intentInputFromLog(log),
            kbTexts,
          );
          const suspected = runSuspectedTechniqueDetection(
            intentInputFromLog(log),
            knowledgeVerdicts,
          );
          await persistSuspectedCandidates(
            {
              class: report.playerClass,
              spec: report.spec,
              dungeon: report.dungeon,
            },
            suspected,
          );
        } catch (err) {
          console.error(
            `[kb] 疑似技巧沉淀降级：${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
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
