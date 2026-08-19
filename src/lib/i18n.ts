/**
 * 全局界面语言偏好（仅影响界面"游戏专有名词"标签，不影响 AI 报告正文）。
 *
 * lang = 'zh' | 'en'，默认 'zh'。持久化到 localStorage；React 上下文见
 * `src/components/LangProvider.tsx`（客户端），本模块保持纯 TS（无 React、
 * 无 "use client"），可被服务端组件安全地 type-only import。
 */

export type Lang = "zh" | "en";

/** localStorage 键。 */
export const LANG_STORAGE_KEY = "wow-analyzer:lang";

/** 任意值归一化为合法 lang（非法/缺失 → 'zh'）。 */
export function normalizeLang(value: string | null | undefined): Lang {
  return value === "en" ? "en" : "zh";
}

/** 读取已持久化的语言偏好；SSR / 无 window / 读取失败 → 'zh'。 */
export function readStoredLang(): Lang {
  if (typeof window === "undefined") return "zh";
  try {
    return normalizeLang(window.localStorage.getItem(LANG_STORAGE_KEY));
  } catch {
    return "zh";
  }
}

/** 持久化语言偏好（失败静默忽略，不阻塞交互）。 */
export function writeStoredLang(lang: Lang): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // 隐私模式 / 存储不可用时静默降级
  }
}
