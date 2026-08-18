import Link from "next/link";

/**
 * 首页占位（T1）：T12 将实现完整的 链接粘贴 / 文件选择 / 登录 / 历史 界面。
 */
export default function Home() {
  return (
    <div className="container">
      <header className="topbar">
        <Link className="brand" href="/">
          WoW M+ AI 复盘教练
        </Link>
      </header>
      <main>
        <div className="card">
          <h1>欢迎使用 WoW M+ AI 复盘教练</h1>
          <p>
            上传大秘境战斗日志，AI 生成结构化复盘报告：识别战术意图、列出可改进点、给出下一步练习建议，
            并支持针对本场 log 的对话问答。
          </p>
          <p>
            <a href="/api/health">查看服务健康状态 /api/health</a>
          </p>
        </div>
      </main>
      <footer className="footer-note">
        非暴雪官方产品，与暴雪娱乐无关。本项目仅用于个人学习与分析，不销售任何游戏内容。
      </footer>
    </div>
  );
}
