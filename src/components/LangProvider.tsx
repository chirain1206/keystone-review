"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { readStoredLang, writeStoredLang, type Lang } from "@/lib/i18n";

/**
 * 全局语言偏好上下文（界面显示元素 zh/en 切换）。
 * 挂在根布局上，TopBar 负责切换、HomeUpload 等负责读取。
 * 首帧渲染默认 'zh'（与服务端一致，避免水合不一致），挂载后从 localStorage 回填。
 */
interface LangContextValue {
  lang: Lang;
  setLang: (next: Lang) => void;
}

const LangContext = createContext<LangContextValue>({
  lang: "zh",
  setLang: () => {},
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("zh");

  useEffect(() => {
    setLangState(readStoredLang());
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    writeStoredLang(next);
  }, []);

  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

/** 读取当前语言与切换函数。 */
export function useLang(): LangContextValue {
  return useContext(LangContext);
}
