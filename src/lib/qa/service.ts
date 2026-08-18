import { getAiProvider } from "@/lib/ai/provider";
import { getRepo } from "@/lib/db";
import type { Conversation } from "@/lib/db/types";
import {
  buildHistoryBlock,
  buildQaContext,
  buildQaSystemPrompt,
  QA_MAX_ROUNDS,
  ROUNDS_EXCEEDED_MESSAGE,
} from "@/lib/qa/prompts";
import { detectViolation, REFUSAL_MESSAGE } from "@/lib/qa/guard";
import { generateKbDelimiters, retrieveKnowledge } from "@/lib/kb/retrieval";

/**
 * 问答服务（T7，FR-6）。
 *  - 单场对话 ≤10 轮（超出提示可重新开始）
 *  - 违规问题（代练/RMT 等）礼貌拒绝
 *  - 上下文 = 结构化事件切片 + 最近历史轮次
 *  - 回答带时间戳/技能证据；通用建议显式标注
 */

export interface QaCallbacks {
  onDelta?: (text: string) => void;
}

export interface QaResult {
  conversationId: string;
  answer: string;
  roundsUsed: number;
  roundsLeft: number;
  refused?: { reason: string }; // 违规拒绝
  roundsExceeded?: boolean;
}

export async function askQuestion(
  userId: string,
  reportId: string,
  question: string,
  conversationId: string | null,
  cb?: QaCallbacks,
): Promise<QaResult> {
  const repo = getRepo();
  const report = await repo.getReport(userId, reportId);
  if (!report) throw new Error("复盘不存在或已被删除");
  const logRecord = await repo.getProcessedLog(userId, reportId);
  if (!logRecord) throw new Error("该复盘缺少结构化数据");

  // 会话：沿用或新建
  let conv: Conversation | null = null;
  if (conversationId) {
    conv = await repo.getConversation(userId, conversationId);
    if (conv && conv.reportId !== reportId) conv = null;
  }
  if (!conv) conv = await repo.createConversation(reportId);

  // 轮次上限（用户消息数）
  const roundsUsed = await repo.countUserMessages(conv.id);
  if (roundsUsed >= QA_MAX_ROUNDS) {
    return {
      conversationId: conv.id,
      answer: "",
      roundsUsed,
      roundsLeft: 0,
      roundsExceeded: true,
    };
  }

  // 违规守卫（规则层；真实模型侧还有提示词层双保险）
  const violation = detectViolation(question);
  if (violation.violated) {
    await repo.addMessage({
      conversationId: conv.id,
      reportId,
      role: "user",
      content: question,
    });
    await repo.addMessage({
      conversationId: conv.id,
      reportId,
      role: "assistant",
      content: REFUSAL_MESSAGE,
      meta: { refused: true },
    });
    return {
      conversationId: conv.id,
      answer: REFUSAL_MESSAGE,
      roundsUsed: roundsUsed + 1,
      roundsLeft: Math.max(0, QA_MAX_ROUNDS - roundsUsed - 1),
      refused: { reason: violation.label ?? "违规内容" },
    };
  }

  // 历史轮次（当前问题入库前的历史）
  const history = await repo.listMessages(userId, reportId, conv.id);

  const context = buildQaContext(logRecord.log);
  // I-6：问答只发问答所需的聚合子集（爆发/减伤/打断/死亡/易伤/位移），
  // 不再嵌入全量 aggregate（perMinute 与 timeline 已由 buildQaContext 紧凑摘要覆盖）。
  const qaJson = JSON.stringify({
    combat: logRecord.log.combat,
    aggregate: {
      cooldowns: logRecord.log.aggregate.cooldowns,
      deaths: logRecord.log.aggregate.deaths,
      interrupts: logRecord.log.aggregate.interrupts,
      vulnerablePhases: logRecord.log.aggregate.vulnerablePhases,
      movement: logRecord.log.aggregate.movement,
      truncated: logRecord.log.aggregate.truncated,
    },
  });
  const userContent =
    `${context}\n\n（本场结构化数据摘要，仅供引用证据：）\n\`\`\`json\n` +
    `${qaJson}\n\`\`\`\n\n` +
    `${history.length ? buildHistoryBlock(history) + "\n" : ""}` +
    `玩家问题：${question}`;

  // FR-11：问答检索注入社区知识（top-k≤5、随机定界包裹、来源标注；失败/未命中降级）。
  // 定界符先生成，与数据区共用同一对随机 token（M-RAG-1 随机定界）。
  const kbDelims = generateKbDelimiters();
  let userContentWithKb = userContent;
  try {
    const kb = await retrieveKnowledge(
      {
        playerClass: report.playerClass,
        playerSpec: report.spec,
        dungeon: report.dungeon,
        question,
      },
      kbDelims,
    );
    if (kb) {
      userContentWithKb = userContent.replace(`玩家问题：${question}`, `${kb.formatted}\n\n玩家问题：${question}`);
    }
  } catch {
    // 降级：仅 log 证据回答（FR-11）
  }

  await repo.addMessage({
    conversationId: conv.id,
    reportId,
    role: "user",
    content: question,
  });

  const ai = getAiProvider();
  let answer = "";
  try {
    const result = await ai.chat(
      [
        { role: "system", content: buildQaSystemPrompt(kbDelims) },
        { role: "user", content: userContentWithKb },
      ],
      { maxTokens: 1200, temperature: 0.4 },
      { onDelta: (d) => {
        answer += d;
        cb?.onDelta?.(d);
      } },
    );
    answer = result.content;
  } catch (err) {
    // 生成失败：不落库错误回答，抛给路由层提示重试
    throw new Error(err instanceof Error ? err.message : "服务繁忙，请稍后重试");
  }

  const generic = answer.includes("通用建议，不是基于本场数据");
  await repo.addMessage({
    conversationId: conv.id,
    reportId,
    role: "assistant",
    content: answer,
    meta: { generic },
  });

  return {
    conversationId: conv.id,
    answer,
    roundsUsed: roundsUsed + 1,
    roundsLeft: Math.max(0, QA_MAX_ROUNDS - roundsUsed - 1),
  };
}

export { ROUNDS_EXCEEDED_MESSAGE };
