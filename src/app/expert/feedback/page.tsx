"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface FeedbackItem {
  id: string;
  email: string | null;
  category: "bug" | "suggestion" | "other";
  content: string;
  pageUrl: string | null;
  status: "new" | "read" | "resolved";
  createdAt: number;
}

interface ListResult {
  ok: boolean;
  error?: string;
  items?: FeedbackItem[];
}

const CATEGORY_META: Record<string, { label: string; cls: string }> = {
  bug: { label: "问题反馈", cls: "badge badge-err" },
  suggestion: { label: "功能建议", cls: "badge badge-ok" },
  other: { label: "其他", cls: "badge" },
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  new: { label: "新", cls: "badge badge-warn" },
  read: { label: "已读", cls: "badge" },
  resolved: { label: "已解决", cls: "badge badge-ok" },
};

const NEXT_ACTION: Record<string, { status: string; label: string } | null> = {
  new: { status: "read", label: "标记为已读" },
  read: { status: "resolved", label: "标记为已解决" },
  resolved: null,
};

/**
 * 专家查看页（FEEDBACK，仅白名单）：展示最近 100 条反馈，支持状态流转
 * new→read→resolved（PATCH /api/feedback）。
 */
export default function ExpertFeedbackPage() {
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const res = await fetch(`/api/feedback?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as ListResult;
      if (!res.ok || !data.ok) {
        setError(data.error ?? `请求失败（${res.status}）`);
        setItems([]);
        return;
      }
      setItems(data.items ?? []);
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setBusy(false);
    }
  }, [status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const advance = async (id: string, next: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? `操作失败（${res.status}）`);
      } else {
        await load();
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const fmtTime = (ms: number) => {
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN");
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22 }}>用户反馈</h1>
      <nav style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 14 }}>
        <Link href="/expert">提交</Link>
        <Link href="/expert/review">审核</Link>
        <Link href="/expert/kb">浏览</Link>
        <Link href="/expert/feedback">反馈</Link>
      </nav>
      <p style={{ color: "var(--text-dim)" }}>
        内测用户与访客提交的意见（最近 100 条）；标记状态推进处理进度。
      </p>

      <div className="card" style={{ marginBottom: 14 }}>
        <select
          className="input"
          style={{ maxWidth: 200 }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">状态：全部</option>
          <option value="new">新</option>
          <option value="read">已读</option>
          <option value="resolved">已解决</option>
        </select>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {items.length === 0 && !busy && !error && (
        <div className="alert alert-info">当前没有反馈。</div>
      )}

      {items.map((it) => {
        const cm = CATEGORY_META[it.category] ?? { label: it.category, cls: "badge" };
        const sm = STATUS_META[it.status] ?? { label: it.status, cls: "badge" };
        const next = NEXT_ACTION[it.status] ?? null;
        return (
          <div className="card" key={it.id} style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 13,
                color: "var(--text-dim)",
                marginBottom: 6,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <span className={cm.cls}>{cm.label}</span>
              <span className={sm.cls}>{sm.label}</span>
              <span>{fmtTime(it.createdAt)}</span>
            </div>
            <div style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}>{it.content}</div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-dim)",
                marginBottom: 12,
                wordBreak: "break-all",
              }}
            >
              {it.email ? `邮箱：${it.email}` : "邮箱：—"} ·{" "}
              {it.pageUrl ? `来源：${it.pageUrl}` : "来源：—"}
            </div>
            {next && (
              <button
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => advance(it.id, next.status)}
              >
                {next.label}
              </button>
            )}
          </div>
        );
      })}
    </main>
  );
}
