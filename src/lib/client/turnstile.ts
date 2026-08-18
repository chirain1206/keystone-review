"use client";

/**
 * Turnstile 客户端辅助（T9/T12）。
 * 配置 NEXT_PUBLIC_TURNSTILE_SITE_KEY 时加载脚本并获取 token；
 * 未配置（mock/开发模式）直接返回 undefined（服务端 mock 模式放行）。
 */

declare global {
  interface Window {
    turnstile?: {
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
      render: (...args: unknown[]) => string;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

let scriptPromise: Promise<void> | null = null;

function ensureScript(): Promise<void> {
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      if (window.turnstile) {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("人机验证组件加载失败"));
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export async function getTurnstileToken(action: string): Promise<string | undefined> {
  if (!SITE_KEY) return undefined; // mock 模式：跳过
  try {
    await ensureScript();
    if (!window.turnstile) return undefined;
    return await window.turnstile.execute(SITE_KEY, { action });
  } catch {
    return undefined;
  }
}
