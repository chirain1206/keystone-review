import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Turnstile 客户端辅助测试（T9/T12 修复验证）。
 * 在 node 环境下 mock 全局 window.turnstile，覆盖：
 *  - 未配置密钥 → 跳过（不触碰 window）
 *  - managed：render 选项正确 + token 300 秒内复用 + 过期重取
 *  - invisible：每次 getToken 重新 execute（token 单次有效）
 */

const SITE_KEY = "test-site-key";

interface TurnstileOptions {
  sitekey?: string;
  action?: string;
  size?: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  [key: string]: unknown;
}

function createTurnstileMock() {
  const widgets = new Map<string, TurnstileOptions>();
  let widgetSeq = 0;
  let tokenSeq = 0;
  const api = {
    render: vi.fn((_container: unknown, options: TurnstileOptions) => {
      const id = `widget-${++widgetSeq}`;
      widgets.set(id, options);
      return id;
    }),
    execute: vi.fn((id: string) => {
      const options = widgets.get(id);
      // 近似真实 execute：异步完成后经 callback 回传 token
      if (options?.callback) queueMicrotask(() => options.callback!(`token-${++tokenSeq}`));
    }),
    remove: vi.fn((id: string) => {
      widgets.delete(id);
    }),
    reset: vi.fn(),
  };
  return { api, widgets };
}

async function loadModule() {
  return await import("@/lib/client/turnstile");
}

describe("Turnstile 客户端辅助", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  });

  describe("未配置 NEXT_PUBLIC_TURNSTILE_SITE_KEY", () => {
    it("isTurnstileConfigured=false，render/getToken 分别返回 false/undefined，不触碰 window", async () => {
      const { isTurnstileConfigured, TurnstileWidget } = await loadModule();
      expect(isTurnstileConfigured()).toBe(false);

      const widget = new TurnstileWidget("login", "managed");
      const container = {} as HTMLElement;
      await expect(widget.render(container)).resolves.toBe(false);
      await expect(widget.getToken()).resolves.toBeUndefined();
    });
  });

  describe("已配置 NEXT_PUBLIC_TURNSTILE_SITE_KEY", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = SITE_KEY;
    });

    it("managed：render 传入正确选项（sitekey/action/size/callback 族）", async () => {
      const { TurnstileWidget } = await loadModule();
      const mock = createTurnstileMock();
      vi.stubGlobal("window", { turnstile: mock.api });

      const widget = new TurnstileWidget("login", "managed");
      await expect(widget.render({} as HTMLElement)).resolves.toBe(true);

      expect(mock.api.render).toHaveBeenCalledTimes(1);
      const options = mock.api.render.mock.calls[0][1] as TurnstileOptions;
      expect(options.sitekey).toBe(SITE_KEY);
      expect(options.action).toBe("login");
      expect(options.size).toBe("flexible");
      expect(typeof options.callback).toBe("function");
      expect(typeof options["expired-callback"]).toBe("function");
      expect(typeof options["error-callback"]).toBe("function");
    });

    it("managed：token 300 秒内复用（execute 仅触发一次）", async () => {
      const { TurnstileWidget } = await loadModule();
      const mock = createTurnstileMock();
      vi.stubGlobal("window", { turnstile: mock.api });

      const widget = new TurnstileWidget("login", "managed");
      await widget.render({} as HTMLElement);

      const t1 = await widget.getToken();
      expect(t1).toBe("token-1");
      expect(mock.api.execute).toHaveBeenCalledTimes(1);

      // 仍在有效期内：复用缓存，不再 execute
      const t2 = await widget.getToken();
      expect(t2).toBe("token-1");
      expect(mock.api.execute).toHaveBeenCalledTimes(1);
    });

    it("managed：token 过期后重新 execute 等待 callback", async () => {
      const { TurnstileWidget } = await loadModule();
      const mock = createTurnstileMock();
      vi.stubGlobal("window", { turnstile: mock.api });

      let now = 1_000_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => now);

      const widget = new TurnstileWidget("login", "managed");
      await widget.render({} as HTMLElement);

      const t1 = await widget.getToken();
      expect(t1).toBe("token-1");
      expect(mock.api.execute).toHaveBeenCalledTimes(1);

      // +60s：仍在 295s 有效期内 → 复用
      now += 60_000;
      expect(await widget.getToken()).toBe("token-1");
      expect(mock.api.execute).toHaveBeenCalledTimes(1);

      // 累计 +360s：超过 295s → 过期重取
      now += 300_000;
      const t3 = await widget.getToken();
      expect(t3).toBe("token-2");
      expect(mock.api.execute).toHaveBeenCalledTimes(2);
    });

    it("managed：expired-callback 清空缓存后重新 execute", async () => {
      const { TurnstileWidget } = await loadModule();
      const mock = createTurnstileMock();
      vi.stubGlobal("window", { turnstile: mock.api });

      const widget = new TurnstileWidget("login", "managed");
      await widget.render({} as HTMLElement);

      expect(await widget.getToken()).toBe("token-1");
      expect(mock.api.execute).toHaveBeenCalledTimes(1);

      // Cloudflare 触发 token 过期回调 → 缓存清空
      const options = mock.api.render.mock.calls[0][1] as TurnstileOptions;
      options["expired-callback"]!();

      expect(await widget.getToken()).toBe("token-2");
      expect(mock.api.execute).toHaveBeenCalledTimes(2);
    });

    it("invisible：每次 getToken 重新 execute 取新 token（不跨提交复用）", async () => {
      const { TurnstileWidget } = await loadModule();
      const mock = createTurnstileMock();
      vi.stubGlobal("window", { turnstile: mock.api });

      const widget = new TurnstileWidget("report_create", "invisible");
      await widget.render({} as HTMLElement);

      const options = mock.api.render.mock.calls[0][1] as TurnstileOptions;
      expect(options.size).toBe("invisible");

      expect(await widget.getToken()).toBe("token-1");
      expect(await widget.getToken()).toBe("token-2");
      expect(mock.api.execute).toHaveBeenCalledTimes(2);
    });

    it("remove：卸载时调用 turnstile.remove 并清理", async () => {
      const { TurnstileWidget } = await loadModule();
      const mock = createTurnstileMock();
      vi.stubGlobal("window", { turnstile: mock.api });

      const widget = new TurnstileWidget("login", "managed");
      await widget.render({} as HTMLElement);
      expect(mock.api.render).toHaveBeenCalledTimes(1);

      widget.remove();
      const widgetId = mock.api.render.mock.results[0].value as string;
      expect(mock.api.remove).toHaveBeenCalledWith(widgetId);
    });
  });
});
