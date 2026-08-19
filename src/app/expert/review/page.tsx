"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { classDisplayName, specDisplayName } from "@/lib/wcl/class-spec-names";

interface CandidateItem {
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
    duplicates?: { id: string; title: string; summary: string; score: number }[];
  };
}

interface ListResult {
  ok: boolean;
  error?: string;
  items?: CandidateItem[];
}

const INTERNAL = "internal:inference";

function specLabel(spec: string): string {
  return spec === "*" ? "通用" : specDisplayName(spec);
}

export default function ExpertReviewPage() {
  const [items, setItems] = useState<CandidateItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/kb/review", { cache: "no-store" });
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: "approve" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/kb/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
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

  const fmtTime = (iso?: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN");
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22 }}>专家审核</h1>
      <nav style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 14 }}>
        <Link href="/expert">提交</Link>
        <Link href="/expert/review">审核</Link>
        <Link href="/expert/kb">浏览</Link>
      </nav>
      <p style={{ color: "var(--text-dim)" }}>
        候选条目（通过前不进入正式分析）；通过 → 生效，驳回 → 弃用。
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {items.length === 0 && !busy && !error && (
        <div className="alert alert-info">当前没有待审核的候选条目。</div>
      )}

      {items.map((it) => (
        <div className="card" key={it.id}>
          <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 6 }}>
            {classDisplayName(it.meta.class)} / {specLabel(it.meta.spec)} · 补丁 {it.meta.patch} · 提交{" "}
            {fmtTime(it.meta.submitted_at)} · {it.meta.submitted_by ?? "—"}
          </div>
          <div style={{ whiteSpace: "pre-wrap", marginBottom: 10 }}>{it.chunkText}</div>
          {it.meta.duplicates && it.meta.duplicates.length > 0 && (
            <div className="alert alert-warn">
              疑似与以下已生效条目重复（提交时查重得出，请确认是否仍保留）：
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {it.meta.duplicates.map((d) => (
                  <li key={d.id}>
                    {d.title} — {d.summary}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>
            来源：{it.meta.source_url === INTERNAL ? "（无外部来源）" : it.meta.source_url}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(it.id, "approve")}>
              通过
            </button>
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => act(it.id, "reject")}>
              驳回
            </button>
          </div>
        </div>
      ))}
    </main>
  );
}
