"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { dungeonDisplayName } from "@/lib/wcl/dungeon-names";
import { specDisplayName } from "@/lib/wcl/class-spec-names";

/**
 * 我的复盘（T12，FR-8）：时间倒序列表、打开、删除（级联）。
 */
interface HistoryReport {
  id: string;
  dungeon: string;
  level: number;
  spec: string;
  playerName: string;
  result: boolean | null;
  status: string;
  createdAt: number;
  sourceType: string;
}

export default function HistoryList() {
  const router = useRouter();
  const [reports, setReports] = useState<HistoryReport[] | null>(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reports", { cache: "no-store" });
      const data = await res.json();
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!data.ok) return setError(data.error ?? "加载失败");
      setReports(data.reports);
    } catch {
      setError("网络错误，请稍后重试");
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    if (!window.confirm("确认删除这条复盘？关联的问答与分享链接将一并失效，且不可恢复。")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) return setError(data.error ?? "删除失败");
      await load();
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <main>
      <h1>我的复盘</h1>
      {error && <div className="alert alert-error">{error}</div>}

      {reports === null ? (
        <div className="card">
          <span className="spinner" /> 加载中…
        </div>
      ) : reports.length === 0 ? (
        <div className="card">
          <p>还没有复盘记录。</p>
          <Link className="btn btn-primary" href="/">
            去生成第一次复盘
          </Link>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="list">
            <thead>
              <tr>
                <th>副本</th>
                <th>层数</th>
                <th>专精</th>
                <th>结果</th>
                <th>状态</th>
                <th>时间</th>
                <th>来源</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/reports/${r.id}`}>{dungeonDisplayName(r.dungeon)}</Link>
                  </td>
                  <td>{r.level}</td>
                  <td>{specDisplayName(r.spec)}</td>
                  <td>
                    {r.result === null ? (
                      "—"
                    ) : (
                      <span className={`badge ${r.result ? "badge-ok" : "badge-err"}`}>
                        {r.result ? "限时成功" : "未限时"}
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        r.status === "ready"
                          ? "badge-ok"
                          : r.status === "failed"
                            ? "badge-err"
                            : "badge-warn"
                      }`}
                    >
                      {r.status === "ready"
                        ? "已完成"
                        : r.status === "failed"
                          ? "部分失败"
                          : "生成中"}
                    </span>
                  </td>
                  <td>{new Date(r.createdAt).toLocaleString("zh-CN")}</td>
                  <td>{r.sourceType === "link" ? "WCL 链接" : "文件"}</td>
                  <td>
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={deleting === r.id}
                      onClick={() => remove(r.id)}
                    >
                      {deleting === r.id ? "…" : "删除"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
