/**
 * Token 估算与预算（FR-10）。
 *
 * 统计口径（PRD FR-10 与 TECH-DESIGN 一致）：
 *   1 token ≈ 3 字符（中英混合文本的保守估算，覆盖 JSON 序列化后的结构化数据）。
 * 实现为纯函数，浏览器（解析后自查）与服务端（T13 再校验）共用同一口径。
 */

export const TOKEN_BUDGET_PER_COMBAT = 50_000; // 每场战斗 ≤50K token（硬性上限）
export const CHAPTER_OUTPUT_TOKEN_CAP = 1_800; // 每章输出封顶（T5）
export const CHARS_PER_TOKEN = 3; // 1 token ≈ 3 字符（口径常量）

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** 结构化数据转成"实际交给 AI 的序列化文本"后估算 token。 */
export function estimateProcessedLogTokens(log: unknown): number {
  return estimateTokens(JSON.stringify(log));
}

export interface TokenBudgetResult {
  ok: boolean;
  tokens: number;
  chars: number;
  budget: number;
}

export function checkTokenBudget(
  text: string,
  budget: number = TOKEN_BUDGET_PER_COMBAT,
): TokenBudgetResult {
  const tokens = estimateTokens(text);
  return { ok: tokens <= budget, tokens, chars: text.length, budget };
}

/** 原始文件缩减率（辅助指标，FR-10：≥90%）。 */
export function reductionRatio(rawChars: number, processedChars: number): number {
  if (rawChars <= 0) return 0;
  return 1 - processedChars / rawChars;
}
