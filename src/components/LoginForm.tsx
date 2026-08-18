"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getTurnstileToken } from "@/lib/client/turnstile";

/**
 * 登录页（T12，FR-7）：邮箱 + 验证码（无密码）。
 * mock 模式提示验证码在服务端控制台日志中查看。
 */
export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mockHint, setMockHint] = useState("");
  const [countdown, setCountdown] = useState(0);

  const requestCode = async () => {
    setError("");
    setMockHint("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setError("请输入有效的邮箱地址");
    }
    setBusy(true);
    try {
      const turnstileToken = await getTurnstileToken("login");
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), turnstileToken }),
      });
      const data = await res.json();
      if (!data.ok) return setError(data.error ?? "发送失败，请稍后重试");
      setStep("code");
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
      <div className="card" style={{ maxWidth: 460, margin: "40px auto" }}>
        <h1>登录 / 注册</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 14 }}>
          无需密码：输入邮箱，我们会发送 6 位验证码（10 分钟内有效，可重发）。
          登录后可保存历史复盘并使用每日 3 次免费额度。
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {mockHint && <div className="alert alert-info">{mockHint}</div>}

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
          disabled={step === "code"}
        />

        {step === "code" && (
          <>
            <div style={{ height: 12 }} />
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
          </>
        )}

        <div style={{ height: 16, display: "flex", gap: 8 }}>
          {step === "email" ? (
            <button className="btn btn-primary" disabled={busy} onClick={requestCode}>
              {busy ? <span className="spinner" /> : "发送验证码"}
            </button>
          ) : (
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
        <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 12 }}>
          继续即表示你同意《用户协议》与《隐私政策》。
        </p>
      </div>
    </main>
  );
}
