export const metadata = { title: "免责声明" };

export default function DisclaimerPage() {
  return (
    <main className="card">
      <h1>免责声明</h1>

      <div className="alert alert-info">
        <b>非暴雪官方产品，与暴雪娱乐无关。</b>
        本项目为第三方个人开发的学习分析工具，未获得暴雪娱乐的认可、赞助或关联授权。
        《魔兽世界》（World of Warcraft）、Warcraft Logs 等名称与商标归各自权利人所有。
      </div>

      <h2>内容声明</h2>
      <ul>
        <li>复盘报告与问答内容由 AI 自动生成，仅供参考，可能存在错误；请结合自身游戏理解判断。</li>
        <li>本产品不销售任何游戏内容，不提供任何代练、陪玩、账号交易服务。</li>
        <li>本产品不收集游戏账号密码；请勿在任何非官方渠道透露账号信息。</li>
      </ul>

      <h2>数据声明</h2>
      <ul>
        <li>上传的战斗日志文件仅在浏览器本地解析，原始文件不会上传到服务器。</li>
        <li>使用 Warcraft Logs 链接仅查询公开元数据，遵守其 API 条款。</li>
      </ul>

      <p>
        如有任何问题，请联系：support@wow-analyzer.local。
      </p>
    </main>
  );
}
