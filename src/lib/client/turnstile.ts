"use client";

/**
 * Turnstile 客户端辅助（T9/T12）。
 *
 * 关键修复：token 只能从「已渲染的 widget」取得——必须先 turnstile.render() 渲染，
 * 再由 callback 回传 token。旧实现只加载脚本后直接 execute(SITE_KEY)，未渲染任何
 * widget，导致 execute 无法产出 token（catch 吞掉返回 undefined）→ 空 token 提交
 * 被生产服务端拒绝（"人机验证未通过"）。
 *
 * 两种 widget 模式：
 *  - managed（可见）：登录页使用，用户能看到并可交互（若有挑战可点击）。
 *  - invisible（不可见）：首页创建复盘等动作使用，渲染到隐藏容器无感取 token。
 *
 * token 生命周期：
 *  - callback 回传后缓存；managed 模式 300 秒（官方有效期）内复用，过期重新
 *    execute(widgetId) 触发刷新并等待 callback。
 *  - invisible 模式每次 getToken() 都重新 execute 取新 token——Turnstile token
 *    单次有效（siteverify 后即失效），同一 token 不能跨两次提交复用。
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

/** Turnstile token 官方有效期 300 秒；留 5 秒余量提前刷新，避免提交途中过期。 */
const TOKEN_TTL_MS = 295_000;

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
 * 单个 Turnstile widget 句柄：render() 渲染后，getToken() 复用/刷新 token。
 */
export class TurnstileWidget {
  private widgetId: string | null = null;
  private container: HTMLElement | null = null;
  private token: string | null = null;
  private tokenIssuedAt = 0;
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
   * 获取可用 token：
   *  - managed：300 秒内复用缓存（callback 已回传），过期/缺失时 execute 重取并等待 callback。
   *  - invisible：每次重新 execute 取新 token（token 单次有效）。
   */
  async getToken(): Promise<string | undefined> {
    if (!SITE_KEY) return undefined;
    if (!this.renderPromise) return undefined; // 尚未渲染
    const ready = await this.renderPromise;
    if (!ready || !this.widgetId || !window.turnstile) return undefined;
    if (
      this.mode === "managed" &&
      this.token &&
      Date.now() - this.tokenIssuedAt < TOKEN_TTL_MS
    ) {
      return this.token;
    }
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
    this.token = null;
    this.tokenIssuedAt = 0;
    this.settle(undefined);
  }

  private waitForToken(): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      this.pendingResolve = resolve;
      this.pendingTimer = setTimeout(() => this.settle(undefined), TOKEN_WAIT_TIMEOUT_MS);
      try {
        window.turnstile!.execute(this.widgetId!);
      } catch {
        this.settle(undefined);
      }
    });
  }

  private onToken(token: string): void {
    this.token = token;
    this.tokenIssuedAt = Date.now();
    this.settle(token);
  }

  private onExpired(): void {
    this.token = null;
    this.tokenIssuedAt = 0;
  }

  private onError(): void {
    this.token = null;
    this.tokenIssuedAt = 0;
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
