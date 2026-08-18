import Link from "next/link";

/** 分享链接无效/已关闭/已过期时的 404（保留原友好文案，语义上返回真 404）。 */
export default function ShareNotFound() {
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
