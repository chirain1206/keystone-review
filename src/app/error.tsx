"use client";

/**
 * 全局错误边界（T13）：任何页面渲染异常都给出可读中文提示，不白屏。
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <div className="card" style={{ textAlign: "center", padding: "48px 20px" }}>
        <h1>页面出错了</h1>
        <p>抱歉，页面渲染出现异常，请重试；如持续出现请稍后再来。</p>
        <button className="btn btn-primary" onClick={reset}>
          重新加载
        </button>
      </div>
    </main>
  );
}
