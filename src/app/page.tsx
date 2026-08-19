import HomeUpload from "@/components/HomeUpload";
import AuthLinkErrorNotice from "@/components/AuthLinkErrorNotice";

export default function Home() {
  return (
    <main>
      <AuthLinkErrorNotice />
      <div className="card" style={{ textAlign: "center", padding: "36px 20px" }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 26 }}>
          看懂你的 log，练对下一把
        </h1>
        <p style={{ color: "var(--text-dim)", maxWidth: 560, margin: "0 auto 4px" }}>
          上传大秘境战斗日志，AI 生成 6 章复盘报告：不只告诉你哪里打错，更解释
          <b>「看似失误实为正确决策」</b>的战术意图，并支持针对本场 log 的追问。
        </p>
        <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
          免费账号每天 3 次复盘 · 中文报告 · 原始日志只在本机解析
        </p>
      </div>

      <HomeUpload />
    </main>
  );
}
