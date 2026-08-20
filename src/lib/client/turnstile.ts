"use client";

/**
 * Turnstile 客户端辅助（T9/T12）。
 *
 * 关键修复（两处）：
 *  1) token 只能从「已渲染的 widget」取得——必须先 turnstile.render() 渲染，
 *     再由 callback 回传 token。旧实现只加载脚本后直接 execute(SITE_KEY)，未渲染任何
 *     widget，导致 execute 无法产出 token（catch 吞掉返回 undefined）→ 空 token 提交
 *     被生产服务端拒绝（"人机验证未通过"）。
 *  2) token 单次有效：siteverify 消费一次后即失效。widget 处于「已解决」状态时
 *     execute() 只会把上次的旧 token 原样经 callback 返回 → 二次提交被服务器判
 *     "timeout-or-duplicate" 拒绝（线上实战踩坑：预览通过、创建复盘必挂）。
 *     因此每次 getToken() 都先 reset() 让 widget 回到未解决态，再 execute() 取新 token。
 *
 * 两种 widget 模式：
 *  - managed（可见）：登录页使用，用户能看到并可交互（若有挑战可点击）。
 *  - invisible（不可见）：首页创建复盘等动作使用，渲染到隐藏容器无感取 token。
 *
 * 未配置 NEXT_PUBLIC_TURNSTILE_SITE_KEY 时，所有方法静默返回 undefined/false，
 * 与旧 getTurnstileToken 行为一致（服务端 mock 模式放行）。
 */

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

interface TurnstileApi {
  render(container: HTMLElement | string, options: TurnstileRenderOptions): string;
  execute(container: HTMLElement | string, params?: { action?: string; cData?: string }): void;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: (code?: string) => void;
  size?: "normal" | "compact" | "flexible" | "invisible";
  theme?: "light" | "dark" | "auto";
  [key: string]: unknown;
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** execute 后等待 callback 的安全超时，防止无回调时提交永久挂起。 */
const TOKEN_WAIT_TIMEOUT_MS = 60_000;

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js";

let scriptPromise: Promise<boolean> | null = null;

/** 幂等加载 api.js 脚本；返回脚本是否可用。 */
function ensureScript(): Promise<boolean> {
  if (!SITE_KEY) return Promise.resolve(false);
  if (!scriptPromise) {
    scriptPromise = new Promise<boolean>((resolve) => {
      if (window.turnstile) {
        resolve(true);
        return;
      }
      const s = document.createElement("script");
      s.src = SCRIPT_URL;
      s.async = true;
      s.onload = () => resolve(Boolean(window.turnstile));
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export function isTurnstileConfigured(): boolean {
  return Boolean(SITE_KEY);
}

export type TurnstileMode = "managed" | "invisible";

/**
 * 单个 Turnstile widget 句柄：render() 渲染后，getToken() 每次 reset+execute 取新 token。
 */
export class TurnstileWidget {
  private widgetId: string | null = null;
  private container: HTMLElement | null = null;
  private pendingResolve: ((token: string | undefined) => void) | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private renderPromise: Promise<boolean> | null = null;

  constructor(
    private readonly action: string,
    private readonly mode: TurnstileMode,
  ) {}

  /** 绑定容器并渲染 widget（幂等）；返回渲染是否成功。 */
  render(container: HTMLElement): Promise<boolean> {
    this.container = container;
    if (!this.renderPromise) {
      this.renderPromise = this.doRender();
    }
    return this.renderPromise;
  }

  private async doRender(): Promise<boolean> {
    if (!SITE_KEY) return false;
    if (!(await ensureScript())) return false;
    const container = this.container;
    if (!container || !window.turnstile) return false;
    try {
      this.widgetId = window.turnstile.render(container, {
        sitekey: SITE_KEY,
        action: this.action,
        size: this.mode === "invisible" ? "invisible" : "flexible",
        callback: (token: string) => this.onToken(token),
        "expired-callback": () => this.onExpired(),
        "error-callback": () => this.onError(),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取一个全新的有效 token：先 reset（回到未解决态）再 execute 并等待 callback。
   * token 单次有效，每次调用必然重新挑战，绝不跨提交复用旧 token。
   */
  async getToken(): Promise<string | undefined> {
    if (!SITE_KEY) return undefined;
    if (!this.renderPromise) return undefined; // 尚未渲染
    const ready = await this.renderPromise;
    if (!ready || !this.widgetId || !window.turnstile) return undefined;
    return this.waitForToken();
  }

  /** 移除 widget 并清理状态（React 卸载时调用）。 */
  remove(): void {
    if (window.turnstile && this.widgetId) {
      try {
        window.turnstile.remove(this.widgetId);
      } catch {
        // 忽略：widget 可能已被平台清理
      }
    }
    this.widgetId = null;
    this.settle(undefined);
  }

  private waitForToken(): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      this.pendingResolve = resolve;
      this.pendingTimer = setTimeout(() => this.settle(undefined), TOKEN_WAIT_TIMEOUT_MS);
      try {
        // 关键：先 reset 再 execute。已解决的 widget 上 execute 只会经 callback 原样
        // 返回旧 token（单次有效、上次已被 siteverify 消费）→ 必须重置换新 token。
        window.turnstile!.reset(this.widgetId!);
        window.turnstile!.execute(this.widgetId!);
      } catch {
        this.settle(undefined);
      }
    });
  }

  private onToken(token: string): void {
    this.settle(token);
  }

  private onExpired(): void {
    this.settle(undefined);
  }

  private onError(): void {
    this.settle(undefined);
  }

  /** 结算一个进行中的等待（幂等）：清理 pending 并 resolve。 */
  private settle(token: string | undefined): void {
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    resolve?.(token);
  }
}
