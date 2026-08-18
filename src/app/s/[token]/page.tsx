import Link from "next/link";
import ReportContent from "@/components/ReportContent";
import { getPublicShareData } from "@/lib/share/service";

export const dynamic = "force-dynamic";

/**
 * GET /s/:token —— 公开只读分享页（FR-9）。
 * 免登录可查看报告全文与问答记录；不展示任何账户信息（邮箱/历史列表）。
 * 分享关闭或 token 不存在 → 链接失效提示。
 */
export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getPublicShareData(token);

  if (!data) {
    return (
      <main>
        <div className="card">
          <h1>分享链接无效</h1>
          <p>该链接不存在、已被关闭或已过期。请向分享者索取新的链接。</p>
          <p>
            <Link href="/">返回首页</Link>
          </p>
        </div>
      </main>
    );
  }

  const doneChapters = data.chapters.filter((c) => c.status === "done" && c.content);

  return (
    <main>
      <div className="card">
        <h1>
          {data.report.dungeon} · {data.report.level} 层
        </h1>
        <p>
          <span className="badge">
            {data.report.playerClass} {data.report.spec}
          </span>{" "}
          <span className={`badge ${data.report.result ? "badge-ok" : "badge-err"}`}>
            {data.report.result ? "限时成功" : "未限时完成"}
          </span>{" "}
          <span className="badge">
            分享于 {new Date(data.report.createdAt).toLocaleDateString("zh-CN")}
          </span>
        </p>
        {data.report.status !== "ready" && (
          <div className="alert alert-info">报告仍在生成中，刷新可查看最新章节。</div>
        )}
        <p style={{ fontSize: 13, color: "var(--text-dim)", margin: "8px 0 0" }}>
          本页面为公开分享的只读复盘，不包含任何账户信息。
        </p>
      </div>

      {doneChapters.map((c) => (
        <section className="card" key={c.chapterNo}>
          <h2>
            第 {c.chapterNo} 章 · {c.title}
          </h2>
          <ReportContent content={c.content} />
        </section>
      ))}

      {data.messages.length > 0 && (
        <section className="card">
          <h2>问答记录（只读）</h2>
          {data.messages.map((m, i) => (
            <div
              key={i}
              className={`qa-message ${m.role === "user" ? "qa-user" : "qa-ai"}`}
            >
              <div className="qa-meta">
                {m.role === "user" ? "提问" : "教练回答"} ·{" "}
                {new Date(m.createdAt).toLocaleString("zh-CN")}
              </div>
              <ReportContent content={m.content} />
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
