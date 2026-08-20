"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTurnstile } from "@/lib/client/useTurnstile";
import {
  parseMagicLinkSource,
  readLastEmail,
  writeLastEmail,
} from "@/lib/auth/magic-link";
import {
  LOGIN_EMAIL_SEND_LABEL,
  LOGIN_LINK_RESEND_HINT,
  LOGIN_LINK_SENT_MESSAGE,
  nextStepAfterSend,
} from "@/lib/auth/login-flow";
import { parseHashSession } from "@/lib/auth/hash-session";

/**
 * 登录页（T12，FR-7）：统一为「邮箱链接登录」——输邮箱 → 发送登录链接 → 点击邮件链接完成。
 * 生产（Supabase）不再要求输 6 位验证码；仅本地 mock 开发模式（无 Supabase 密钥、
 * 发 6 位验证码）保留输码步骤。
 */
export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "sent" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mockHint, setMockHint] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [linkBusy, setLinkBusy] = useState(false);
  // 防止 React 严格模式/重复渲染导致魔法链接 token_hash（一次性）被重复提交
  const linkAttempted = useRef(false);
  // 隐式流 hash token 消费状态：consumed=已成功登录（防重复消费）；
  // inFlight=正在消费中（防并发重复）。失败时两者都不置位 → 刷新页面可重试。
  const hashConsumedRef = useRef(false);
  const hashInFlightRef = useRef(false);

  // 可见的 managed widget：用户能看到并可交互（若有挑战可点击），token 由 callback 存储
  const { containerRef, getToken, configured } = useTurnstile("login", "managed");

  // 隐式流自动登录：signInWithOtp 链接的 token 挂在 URL hash（#access_token=...），
  // 不经过 supabase.co 验证页、不依赖第三方 Cookie。消费 hash：直接 POST
  // /api/auth/session-sync，由服务端做权威校验（GoTrue 真实验签）并写入 SSR cookie。
  // 注意：浏览器端不再用 supabase-js 直连 supabase.co 做「预校验」——其 setSession
  // 内部会跨域直连 GoTrue 验证 token，在中国网络环境易被安全软件/浏览器插件拦截
  // （且该预校验本就多余：服务端 setSession 同样会真实验签）。
  // 两个触发场景（见下方两个 effect）：
  //   A. 新标签页/整页加载打开链接（hash 已存在）→ 挂载时消费；
  //   B. 当前标签页已在 /login 上，点邮件链接只改变 hash——浏览器对「仅 hash 变化」
  //      的跳转不重载页面、不重新挂载 React，必须监听 hashchange 兜底消费。
  const consumeHashSession = useCallback(async () => {
    if (hashConsumedRef.current || hashInFlightRef.current) return;
    const tokens = parseHashSession(window.location.hash);
    if (!tokens) return;
    hashInFlightRef.current = true;
    setBusy(true);
    setLinkBusy(true);
    try {
      const res = await fetch("/api/auth/session-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tokens),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "链接已失效，请重新登录");
        return;
      }
      hashConsumedRef.current = true;
      // 清空 hash，避免刷新/回退时重复消费一次性 token
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      router.push("/");
      router.refresh();
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      hashInFlightRef.current = false;
      setBusy(false);
      setLinkBusy(false);
    }
  }, [router]);

  // 场景 A：整页加载时 hash 已存在 → 挂载即消费
  useEffect(() => {
    void consumeHashSession();
  }, [consumeHashSession]);

  // 场景 B：同一标签页内 hash 后续变化（点邮件链接、页面不重载）→ 监听兜底
  useEffect(() => {
    const onHashChange = () => void consumeHashSession();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [consumeHashSession]);

  // 魔法链接自动登录：用户点击邮件链接后带 ?token_hash=...（老形式 ?code=...）
  // 回到本页 → 直接建立会话。source 一并上报，供服务端对老形式 ?code= 做 signup 回退。
  useEffect(() => {
    if (linkAttempted.current) return;
    const parsed = parseMagicLinkSource(window.location.search);
    if (!parsed) return;
    linkAttempted.current = true;
    setLinkBusy(true);
    setBusy(true);

    const lastEmail = readLastEmail();
    const body: { tokenHash: string; source: "token_hash" | "code"; email?: string } = {
      tokenHash: parsed.tokenHash,
      source: parsed.source,
    };
    if (lastEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lastEmail)) {
      body.email = lastEmail;
    }

    void (async () => {
      try {
        const res = await fetch("/api/auth/verify-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.ok) {
          setError(data.error ?? "链接已失效，请重新登录");
          return;
        }
        router.push("/");
        router.refresh();
      } catch {
        setError("网络错误，请稍后重试");
      } finally {
        setBusy(false);
        setLinkBusy(false);
      }
    })();
  }, [router]);

  // 重新发送倒计时（60 秒后恢复可用）
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const requestCode = async () => {
    setError("");
    setMockHint("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setError("请输入有效的邮箱地址");
    }
    // 记住最近邮箱：魔法链接登录时一并带上（兼容 verifyOtp 需要 email 的情况）
    writeLastEmail(email.trim());
    setBusy(true);
    try {
      const turnstileToken = await getToken();
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), turnstileToken }),
      });
      const data = await res.json();
      if (!data.ok) return setError(data.error ?? "发送失败，请稍后重试");
      // 生产 → 提示查收链接；mock → 保留输码
      setStep(nextStepAfterSend(Boolean(data.mockMode)));
      if (data.mockHint) setMockHint(data.mockHint);
      setCountdown(60);
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setError("");
    if (!/^\d{6}$/.test(code.trim())) return setError("验证码为 6 位数字");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = await res.json();
      if (!data.ok) return setError(data.error ?? "验证失败，请重试");
      router.push("/");
      router.refresh();
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <div className="card login-card">
        <h1>登录 / 注册</h1>
        <p className="login-sub">
          无需密码：输入邮箱，我们会发送登录链接（10 分钟内有效，可重发）。
          登录后可保存历史复盘并使用每日 3 次免费额度。
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {linkBusy && <div className="alert alert-info">正在登录…</div>}
        {mockHint && <div className="alert alert-info">{mockHint}</div>}
        {step === "sent" && (
          <div className="alert alert-info">
            {LOGIN_LINK_SENT_MESSAGE}
            <div className="login-resend-hint">
              {LOGIN_LINK_RESEND_HINT}
              {countdown > 0 ? `（${countdown}s 后可重新发送）` : ""}
            </div>
          </div>
        )}

        <div className="login-form">
          <div className="field">
            <label className="label" htmlFor="email">
              邮箱
            </label>
            <input
              id="email"
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={step === "code" || linkBusy}
            />
          </div>

          {step === "code" && (
            <div className="field">
              <label className="label" htmlFor="code">
                验证码
              </label>
              <input
                id="code"
                className="input"
                inputMode="numeric"
                maxLength={6}
                placeholder="6 位数字验证码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
          )}

          <div className="login-actions">
            {step === "email" && (
              <button className="btn btn-primary" disabled={busy} onClick={requestCode}>
                {busy ? <span className="spinner" /> : LOGIN_EMAIL_SEND_LABEL}
              </button>
            )}

            {step === "sent" && (
              <>
                <button
                  className="btn btn-primary"
                  disabled={busy || countdown > 0}
                  onClick={requestCode}
                >
                  重新发送
                </button>
                <button className="btn" onClick={() => setStep("email")}>
                  更换邮箱
                </button>
              </>
            )}

            {step === "code" && (
              <>
                <button className="btn btn-primary" disabled={busy} onClick={verifyCode}>
                  {busy ? <span className="spinner" /> : "登录"}
                </button>
                <button
                  className="btn"
                  disabled={busy || countdown > 0}
                  onClick={() => {
                    setStep("email");
                    setCode("");
                  }}
                >
                  更换邮箱
                </button>
              </>
            )}
          </div>

          {configured && (
            <div
              ref={containerRef}
              className="turnstile-widget"
              style={{ display: step === "email" ? undefined : "none" }}
            />
          )}
        </div>

        <p className="login-terms">
          继续即表示你同意《用户协议》与《隐私政策》。
        </p>
      </div>
    </main>
  );
}
