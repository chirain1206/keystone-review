import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <div className="card" style={{ textAlign: "center", padding: "48px 20px" }}>
        <h1>页面不存在</h1>
        <p>你访问的页面可能已被删除，或链接有误。</p>
        <Link className="btn btn-primary" href="/">
          返回首页
        </Link>
      </div>
    </main>
  );
}
