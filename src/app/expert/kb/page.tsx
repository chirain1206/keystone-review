"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ALL_CLASS_NAMES, classDisplayName, specDisplayName } from "@/lib/wcl/class-spec-names";

interface KbItem {
  id: string;
  chunkText: string;
  meta: {
    class: string;
    spec: string;
    dungeon: string;
    patch: string;
    type: string;
    source_url: string;
    origin: string;
    status: string;
    submitted_by?: string;
    submitted_at?: string;
  };
}

interface ListResult {
  ok: boolean;
  error?: string;
  items?: KbItem[];
}

const INTERNAL = "internal:inference";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: "生效", cls: "badge badge-ok" },
  candidate: { label: "候选", cls: "badge badge-warn" },
  deprecated: { label: "弃用", cls: "badge badge-err" },
};

function specLabel(spec: string): string {
  return spec === "*" ? "通用" : specDisplayName(spec);
}

function summaryOf(text: string, max = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? normalized.slice(0, max) + "…" : normalized;
}

export default function ExpertKbPage() {
  const [patch, setPatch] = useState("");
  const [status, setStatus] = useState("");
  const [cls, setCls] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<KbItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (patch.trim()) params.set("patch", patch.trim());
      if (status) params.set("status", status);
      if (cls) params.set("class", cls);
      if (q.trim()) params.set("q", q.trim());
      params.set("limit", "50");
      const res = await fetch(`/api/kb/list?${params.toString()}`, { cache: "no-store" });
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
  }, [patch, status, cls, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22 }}>知识库浏览</h1>
      <nav style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 14 }}>
        <Link href="/expert">提交</Link>
        <Link href="/expert/review">审核</Link>
        <Link href="/expert/kb">浏览</Link>
      </nav>
      <p style={{ color: "var(--text-dim)" }}>
        只读查阅全部条目（生效/候选/弃用），避免重复提交。
      </p>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <select className="input" style={{ flex: 1, minWidth: 120 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">状态：全部</option>
            <option value="active">生效</option>
            <option value="candidate">候选</option>
            <option value="deprecated">弃用</option>
          </select>
          <select className="input" style={{ flex: 1, minWidth: 120 }} value={cls} onChange={(e) => setCls(e.target.value)}>
            <option value="">职业：全部</option>
            {ALL_CLASS_NAMES.map((c) => (
              <option key={c} value={c}>{classDisplayName(c)}</option>
            ))}
          </select>
          <input
            className="input"
            style={{ flex: 1, minWidth: 120 }}
            value={patch}
            onChange={(e) => setPatch(e.target.value)}
            placeholder="补丁（如 12.1 / general）"
          />
          <input
            className="input"
            style={{ flex: 1, minWidth: 160 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="关键词搜索"
          />
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {items.length === 0 && !busy && !error && (
        <div className="alert alert-info">没有匹配的条目。</div>
      )}

      {items.map((it) => {
        const sm = STATUS_META[it.meta.status] ?? { label: it.meta.status, cls: "badge" };
        return (
          <div className="card" key={it.id} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className={sm.cls}>{sm.label}</span>
              <span>{classDisplayName(it.meta.class)}</span>
              <span>{specLabel(it.meta.spec)}</span>
              <span>补丁 {it.meta.patch}</span>
              <span>来源 {it.meta.origin}</span>
            </div>
            <div style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}>{summaryOf(it.chunkText)}</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
              出处：{it.meta.source_url === INTERNAL ? "（无外部来源）" : it.meta.source_url}
            </div>
          </div>
        );
      })}
    </main>
  );
}
