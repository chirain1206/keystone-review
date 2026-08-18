export const metadata = { title: "隐私政策" };

export default function PrivacyPage() {
  return (
    <main className="card">
      <h1>隐私政策</h1>
      <p>生效日期：2026 年 8 月</p>

      <h2>我们收集什么</h2>
      <ul>
        <li>
          <b>邮箱地址</b>：用于无密码登录（验证码登录），验证码邮件由第三方邮件服务发送。
        </li>
        <li>
          <b>你上传的战斗日志</b>：WoWCombatLog.txt 在<b>你的浏览器本地</b>解析，原始文件
          <b>绝不上传服务器</b>；服务器只保存解析后的精简结构化数据（时间线关键事件与聚合统计），
          用于生成复盘报告与回答问题。
        </li>
        <li>
          <b>使用数据</b>：仅用于安全防护的最小日志（IP 频控、人机验证），不用于广告。
        </li>
      </ul>

      <h2>数据用于什么</h2>
      <ul>
        <li>生成 AI 复盘报告（结构化数据会发送给 AI 服务商以生成内容）。</li>
        <li>回答你对本场 log 的追问。</li>
        <li>保存历史复盘供你回看；你开启的分享链接对他人可见（只读）。</li>
      </ul>

      <h2>如何删除</h2>
      <ul>
        <li>在「我的复盘」中删除任意记录：报告、章节、问答与分享链接一并删除。</li>
        <li>
          申请注销账号：发送邮件至 support@wow-analyzer.local，我们将在 7 个工作日内删除你的全部数据
          （邮箱、复盘记录、结构化日志、问答）。
        </li>
      </ul>

      <h2>我们不做什么</h2>
      <ul>
        <li>不收集、不索要你的游戏账号密码。</li>
        <li>不出售、不分享你的个人信息给第三方（除生成报告所必需的数据处理服务）。</li>
        <li>不提供任何代练、账号交易、陪玩功能。</li>
      </ul>

      <h2>第三方服务</h2>
      <p>
        登录邮件（Resend/Supabase）、AI 生成（DeepSeek）、日志平台元数据（Warcraft Logs API）、
        人机验证（Cloudflare Turnstile）。仅传输完成功能所必需的最少数据。
      </p>

      <h2>联系方式</h2>
      <p>support@wow-analyzer.local</p>
    </main>
  );
}
