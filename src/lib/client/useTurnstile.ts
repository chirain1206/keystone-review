"use client";

import { useCallback, useEffect, useRef } from "react";
import { isTurnstileConfigured, TurnstileWidget, type TurnstileMode } from "./turnstile";

/**
 * Turnstile React hook：
 *  - managed（可见）：LoginForm 使用，容器 div 可见可交互（若有挑战可点击）。
 *  - invisible（不可见）：HomeUpload 使用，容器 div 隐藏，无感取 token。
 *
 * 返回：
 *  - containerRef：绑定到承载 widget 的容器 div（必须始终挂载，勿条件渲染）。
 *  - getToken：取 token（未配置时返回 undefined，与旧 getTurnstileToken 行为一致）。
 *  - configured：是否已配置 NEXT_PUBLIC_TURNSTILE_SITE_KEY。
 */
export function useTurnstile(action: string, mode: TurnstileMode) {
  const configured = isTurnstileConfigured();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<TurnstileWidget | null>(null);

  useEffect(() => {
    if (!configured) return;
    const container = containerRef.current;
    if (!container) return;
    const widget = new TurnstileWidget(action, mode);
    widgetRef.current = widget;
    void widget.render(container);
    return () => {
      widget.remove();
      widgetRef.current = null;
    };
  }, [configured, action, mode]);

  const getToken = useCallback(async (): Promise<string | undefined> => {
    return widgetRef.current?.getToken();
  }, []);

  return { containerRef, getToken, configured };
}
