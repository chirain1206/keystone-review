"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ReportContent from "@/components/ReportContent";
import { readSseStream } from "@/lib/client/sse";
import { dungeonDisplayName } from "@/lib/wcl/dungeon-names";

/**
 * 报告页（T12，FR-4/FR-6/FR-8/FR-9）：
 *  - 章节进度（6 章并行 SSE 边生成边显示）
 *  - 失败章节单章重试（断点续跑）
 *  - 问答框（10 轮上限、违规拒绝、证据标注）
 *  - 一键分享开关 / 删除
 */

interface Chapter {
  chapterNo: number;
  title: string;
  content: string;
  status: "pending" | "running" | "done" | "failed";
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}
interface ReportInfo {
  id: string;
  dungeon: string;
  level: number;
  spec: string;
  playerName: string;
  playerClass: string;
  result: boolean | null;
  status: string;
  sourceType: string;
  compareMeta: { url: string; title?: string; note?: string } | null;
  mock?: boolean;
  createdAt: number;
}
interface Message {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  conversationId?: string;
  meta?: { refused?: boolean; generic?: boolean };
}
interface Detail {
  ok: boolean;
  report?: ReportInfo;
  chapters?: Chapter[];
  messages?: Message[];
  share?: { enabled: boolean; token: string } | null;
}

const CHAPTER_TITLES = [
  "总体概览",
  "关键时机分析",
  "与顶尖玩家对比",
  "可改进点清单",
  "战术意图识别",
  "下一步练习建议",
];

export default function ReportView({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [buffers, setBuffers] = useState<Record<number, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [genStarted, setGenStarted] = useState(false);

  // 问答
  const [question, setQuestion] = useState("");
  const [qaBusy, setQaBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [roundsLeft, setRoundsLeft] = useState<number | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const qaBoxRef = useRef<HTMLDivElement>(null);

  // 分享
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareEnabled, setShareEnabled] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports/${reportId}`, { cache: "no-store" });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data: Detail = await res.json();
      if (!data.ok || !data.report) {
        setError(data.ok ? "" : "复盘不存在或已被删除");
        return;
      }
      setDetail(data);
      setChapters(data.chapters ?? []);
      setMessages(data.messages ?? []);
      const userMsgs = (data.messages ?? []).filter((m) => m.role === "user").length;
      setRoundsLeft(Math.max(0, 10 - userMsgs));
      if ((data.messages ?? []).length > 0) {
        setConvId((data.messages ?? [])[0].conversationId ?? null);
      }      if (data.share?.enabled) {
        setShareEnabled(true);
        setShareUrl(`${window.location.origin}/s/${data.share.token}`);
      }
    } catch {
      setError("网络错误，请稍后重试");
    }
  }, [reportId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const report = detail?.report;
  const needGenerate =
    report &&
    chapters.length < 6 &&
    !genStarted &&
    report.status !== "failed";

  // 自动开始生成（幂等：已完成章节服务端跳过）
  useEffect(() => {
    if (!needGenerate || running) return;
    setGenStarted(true);
    void startGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needGenerate]);

  const startGenerate = async () => {
    setRunning(true);
    setError("");
    try {
      const res = await fetch(`/api/reports/${reportId}/generate`, {
        method: "POST",
        cache: "no-store",
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      await readSseStream(res, (event, data) => {
        const d = data as Record<string, unknown>;
        if (event === "status") {
          const no = Number(d.chapterNo);
          setChapters((prev) =>
            prev.map((c) => (c.chapterNo === no ? { ...c, status: d.status as Chapter["status"] } : c)),
          );
          if (d.status === "done") {
            void load();
          }
        } else if (event === "delta") {
          const no = Number(d.chapterNo);
          setBuffers((prev) => ({ ...prev, [no]: (prev[no] ?? "") + String(d.delta ?? "") }));
        } else if (event === "error") {
          setError(String(d.message ?? "生成失败，请稍后重试"));
        } else if (event === "done") {
          setRunning(false);
          void load();
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败，请稍后重试");
    } finally {
      setRunning(false);
      void load();
    }
  };

  const retryChapter = async (chapterNo: number) => {
    setError("");
    setBuffers((prev) => ({ ...prev, [chapterNo]: "" }));
    setChapters((prev) =>
      prev.map((c) => (c.chapterNo === chapterNo ? { ...c, status: "running" } : c)),
    );
    try {
      const res = await fetch(`/api/reports/${reportId}/chapters/${chapterNo}`, {
        method: "POST",
        cache: "no-store",
      });
      await readSseStream(res, (event, data) => {
        const d = data as Record<string, unknown>;
        if (event === "status") {
          setChapters((prev) =>
            prev.map((c) =>
              c.chapterNo === Number(d.chapterNo) ? { ...c, status: d.status as Chapter["status"] } : c,
            ),
          );
        } else if (event === "delta") {
          setBuffers((prev) => ({
            ...prev,
            [Number(d.chapterNo)]: (prev[Number(d.chapterNo)] ?? "") + String(d.delta ?? ""),
          }));
        } else if (event === "done") {
          void load();
        } else if (event === "error") {
          setError(String(d.message ?? "重试失败"));
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "重试失败");
    } finally {
      void load();
    }
  };

  // ---------- 问答 ----------
  const ask = async () => {
    if (!question.trim() || qaBusy) return;
    if (roundsLeft !== null && roundsLeft <= 0) {
      setError("本轮对话已结束，可重新开始");
      return;
    }
    setError("");
    const q = question.trim();
    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", content: q, createdAt: Date.now() }]);
    setQaBusy(true);
    try {
      const res = await fetch(`/api/reports/${reportId}/qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, conversationId: convId }),
      });
      let streamed = "";
      await readSseStream(res, (event, data) => {
        const d = data as Record<string, unknown>;
        if (event === "delta") {
          streamed += String(d.text ?? "");
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant" && (last as Message & { streaming?: boolean }).streaming) {
              next[next.length - 1] = { ...last, content: streamed };
            } else {
              next.push({ role: "assistant", content: streamed, createdAt: Date.now(), streaming: true } as Message);
            }
            return next;
          });
        } else if (event === "done") {
          setConvId(String(d.conversationId));
          setRoundsLeft(Number(d.roundsLeft));
        } else if (event === "refused") {
          setConvId(String(d.conversationId));
        } else if (event === "error") {
          setError(String(d.message ?? "回答失败，请稍后重试"));
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "回答失败，请稍后重试");
    } finally {
      setQaBusy(false);
      void load(); // 落库后同步一次（含 refused 消息）
      requestAnimationFrame(() => qaBoxRef.current?.scrollTo({ top: 99999, behavior: "smooth" }));
    }
  };

  // ---------- 分享 ----------
  const toggleShare = async (enable: boolean) => {
    try {
      const res = await fetch(`/api/reports/${reportId}/share`, {
        method: enable ? "POST" : "DELETE",
      });
      const data = await res.json();
      if (!data.ok) return setError(data.error ?? "操作失败");
      if (enable) {
        setShareUrl(data.url);
        setShareEnabled(true);
      } else {
        setShareEnabled(false);
        setShareUrl(null);
      }
    } catch {
      setError("网络错误，请稍后重试");
    }
  };

  const copyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setError("");
      window.alert("链接已复制");
    } catch {
      setError("复制失败，请手动复制链接");
    }
  };

  // ---------- 删除 ----------
  const removeReport = async () => {
    if (!window.confirm("确认删除本场复盘？关联问答与分享链接将一并失效。")) return;
    const res = await fetch(`/api/reports/${reportId}`, { method: "DELETE" });
    const data = await res.json();
    if (!data.ok) return setError(data.error ?? "删除失败");
    router.push("/history");
  };

  if (!detail) {
    return (
      <div className="card">
        {error ? <div className="alert alert-error">{error}</div> : <span className="spinner" />}
        {error && (
          <Link className="btn" href="/history">
            返回我的复盘
          </Link>
        )}
      </div>
    );
  }

  const sorted = [...chapters].sort((a, b) => a.chapterNo - b.chapterNo);
  const doneCount = sorted.filter((c) => c.status === "done").length;

  return (
    <main>
      <div className="card">
        {report!.mock && (
          <div className="alert alert-warn" style={{ marginBottom: 12 }}>
            ⚠️ 演示数据（未配置 WCL 密钥）：本场战斗为示例内容，非真实 Warcraft Logs
            数据。
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ margin: 0 }}>
            {dungeonDisplayName(report!.dungeon)} · {report!.level} 层
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            {!shareEnabled ? (
              <button className="btn btn-sm" onClick={() => toggleShare(true)}>
                🔗 分享
              </button>
            ) : (
              <button className="btn btn-sm btn-danger" onClick={() => toggleShare(false)}>
                关闭分享
              </button>
            )}
            <button className="btn btn-sm btn-danger" onClick={removeReport}>
              删除复盘
            </button>
          </div>
        </div>
        <p>
          <span className="badge">
            {report!.playerClass} {report!.spec}
          </span>{" "}
          {report!.result !== null && (
            <span className={`badge ${report!.result ? "badge-ok" : "badge-err"}`}>
              {report!.result ? "限时成功" : "未限时完成"}
            </span>
          )}{" "}
          <span className="badge">{new Date(report!.createdAt).toLocaleString("zh-CN")}</span>{" "}
          {report!.compareMeta?.note && (
            <span className="badge badge-warn">{report!.compareMeta.note}</span>
          )}
        </p>
        {shareEnabled && shareUrl && (
          <div className="alert alert-ok" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span>分享链接（免登录只读）：</span>
            <code style={{ wordBreak: "break-all", flex: 1 }}>{shareUrl}</code>
            <button className="btn btn-sm" onClick={copyShare}>
              复制
            </button>
          </div>
        )}
        {error && <div className="alert alert-error">{error}</div>}
      </div>

      {/* 章节进度 */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <strong>报告进度</strong>
          <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
            {doneCount}/6 章{running && " · 生成中"}
          </span>
        </div>
        <div className="progress">
          <div style={{ width: `${(doneCount / 6) * 100}%` }} />
        </div>
      </div>

      {/* 章节内容 */}
      {sorted.map((c, i) => {
        const title = c.title || CHAPTER_TITLES[c.chapterNo - 1] || `第 ${c.chapterNo} 章`;
        // 无对比链接时第 3 章内容为空 → 不显示
        if (c.status === "done" && !c.content) return null;
        const streaming = buffers[c.chapterNo] ?? "";
        return (
          <section className="card" key={c.chapterNo}>
            <div className="chapter-row" style={{ border: "none", padding: "0 0 10px", marginBottom: 0 }}>
              <span className={`chapter-status ${c.status}`} />
              <h2 style={{ margin: 0, flex: 1, fontSize: 16 }}>
                第 {c.chapterNo} 章 · {title}
              </h2>
              {c.status === "failed" && (
                <button className="btn btn-sm" onClick={() => retryChapter(c.chapterNo)}>
                  ↻ 重试本章
                </button>
              )}
              {c.status === "running" && <span className="spinner" />}
              {c.status === "done" && c.tokensIn !== undefined && (
                <span className="qa-meta">
                  输入 {c.tokensIn} tok · 输出 {c.tokensOut} tok · ${(c.costUsd ?? 0).toFixed(4)}
                </span>
              )}
            </div>
            {c.status === "done" && c.content && <ReportContent content={c.content} />}
            {c.status === "running" && streaming && <ReportContent content={streaming} />}
            {c.status === "running" && !streaming && (
              <p style={{ color: "var(--text-dim)" }}>正在生成…</p>
            )}
            {c.status === "pending" && !running && (
              <p style={{ color: "var(--text-dim)" }}>待生成</p>
            )}
            {c.status === "failed" && (
              <p style={{ color: "var(--danger)" }}>
                本章生成失败（服务繁忙或超时）。可点击「重试本章」单独重跑，不影响其他章节。
              </p>
            )}
            {i < sorted.length - 1 && <div style={{ height: 8 }} />}
          </section>
        );
      })}

      {/* 问答框 */}
      <section className="card">
        <h2>针对本场 log 提问</h2>
        <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
          回答引用本场时间戳与技能证据；单场对话 10 轮
          {roundsLeft !== null && `（剩余 ${roundsLeft} 轮）`}。
        </p>
        <div ref={qaBoxRef} style={{ maxHeight: 420, overflowY: "auto", marginBottom: 12 }}>
          {messages.length === 0 && (
            <p style={{ color: "var(--text-dim)" }}>
              例：「我这波爆发为什么打低了？」「5:36 我喝药水的时机对吗？」
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`qa-message ${m.role === "user" ? "qa-user" : "qa-ai"}`}>
              <div className="qa-meta">
                {m.role === "user" ? "我" : "教练"} · {new Date(m.createdAt).toLocaleTimeString("zh-CN")}
                {(m.meta?.refused || m.meta?.generic) && (
                  <span className="badge badge-warn">
                    {m.meta.refused ? "已拒绝" : "通用建议"}
                  </span>
                )}
              </div>
              <ReportContent content={m.content} />
            </div>
          ))}
          {qaBusy && (
            <div className="qa-message qa-ai">
              <span className="spinner" /> 思考中…
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input"
            placeholder={roundsLeft === 0 ? "本轮对话已结束，可重新开始" : "输入你的问题（≤500 字）"}
            value={question}
            disabled={qaBusy || roundsLeft === 0}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void ask();
            }}
          />
          <button className="btn btn-primary" disabled={qaBusy || roundsLeft === 0 || !question.trim()} onClick={ask}>
            {qaBusy ? <span className="spinner" /> : "提问"}
          </button>
        </div>
      </section>
    </main>
  );
}
