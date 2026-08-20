"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useTurnstile } from "@/lib/client/useTurnstile";
import { FEEDBACK_CATEGORIES, type FeedbackCategory } from "@/lib/feedback/types";

/**
 * 全站右下角悬浮「反馈」按钮（FEEDBACK）：
 *  - 点开小型弹窗表单：分类下拉 / 内容 textarea / 邮箱输入（登录态自动隐藏）
 *  - 提交成功提示「感谢反馈！」；样式沿用 globals.css 的卡片/按钮风格
 *  - Turnstile 不可见 widget 无感取 token（未配置密钥时为空）
 */
const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "🐞 问题反馈",
  suggestion: "💡 功能建议",
  other: "💬 其他",
};

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("suggestion");
  const [content, setContent] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const pathname = usePathname();
  const { containerRef: turnstileRef, getToken } = useTurnstile("feedback", "invisible");

  // 登录态：登录后隐藏邮箱输入（服务端自动关联 user_id）
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await res.json();
        setLoggedIn(Boolean(data?.ok));
      } catch {
        setLoggedIn(false);
      }
    })();
  }, []);

  const openPanel = () => {
    setDone(false);
    setError("");
    setOpen(true);
  };

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setError("");
    setDone(false);
  }, [busy]);

  const submit = async () => {
    setError("");
    if (!content.trim()) {
      setError("请填写反馈内容");
      return;
    }
    setBusy(true);
    try {
      const turnstileToken = await getToken();
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          content: content.trim(),
          email: email.trim() || undefined,
          page_url: pathname || "/",
          turnstileToken,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "提交失败，请稍后重试");
        return;
      }
      setDone(true);
      setContent("");
      setEmail("");
      setCategory("suggestion");
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Turnstile 不可见 widget 容器（无感人机验证；未配置密钥时为空） */}
      <div ref={turnstileRef} aria-hidden="true" style={{ display: "none" }} />

      <button type="button" className="feedback-fab" aria-label="反馈" onClick={openPanel}>
        💬 反馈
      </button>

      {open && (
        <div className="feedback-overlay" onClick={close}>
          <div
            className="feedback-modal card"
            role="dialog"
            aria-modal="true"
            aria-label="提交反馈"
            onClick={(e) => e.stopPropagation()}
          >
            {done ? (
              <div className="feedback-done">
                <div className="alert alert-ok" style={{ marginBottom: 12, marginTop: 0 }}>
                  感谢反馈！
                </div>
                <button className="btn" onClick={close}>
                  关闭
                </button>
              </div>
            ) : (
              <>
                <div className="feedback-modal-head">
                  <strong>提交反馈</strong>
                  <button
                    type="button"
                    className="feedback-close"
                    aria-label="关闭"
                    onClick={close}
                  >
                    ✕
                  </button>
                </div>

                <label className="label" htmlFor="fb-category">
                  分类
                </label>
                <select
                  id="fb-category"
                  className="input"
                  style={{ marginBottom: 12 }}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
                >
                  {FEEDBACK_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>

                <label className="label" htmlFor="fb-content">
                  内容
                </label>
                <textarea
                  id="fb-content"
                  className="textarea"
                  rows={5}
                  maxLength={2000}
                  placeholder="你的意见或建议…（最多 2000 字）"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />

                {!loggedIn && (
                  <>
                    <label className="label" htmlFor="fb-email" style={{ marginTop: 12 }}>
                      邮箱（可选，便于我们回复）
                    </label>
                    <input
                      id="fb-email"
                      className="input"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </>
                )}

                {error && (
                  <div className="alert alert-error" style={{ marginBottom: 0, marginTop: 12 }}>
                    {error}
                  </div>
                )}

                <div className="feedback-actions">
                  <button className="btn" onClick={close} disabled={busy}>
                    取消
                  </button>
                  <button className="btn btn-primary" onClick={submit} disabled={busy}>
                    {busy ? <span className="spinner" /> : "提交"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
