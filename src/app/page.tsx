import { redirect } from "next/navigation";
import HomeUpload from "@/components/HomeUpload";
import AuthLinkErrorNotice from "@/components/AuthLinkErrorNotice";
import { parseMagicLinkSource } from "@/lib/auth/magic-link";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // 魔法链接回调（?token_hash= / ?code=）若落在根页，重定向到 /login 统一处理并带上参数。
  // 仅当存在非空 token_hash/code 才重定向；?error= 过期提示仍由 AuthLinkErrorNotice 在根页展示，
  // 二者不冲突（error 参数不触发重定向）。
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) for (const item of v) qs.append(k, item);
    else if (typeof v === "string") qs.set(k, v);
  }
  const search = qs.toString();
  if (parseMagicLinkSource(search) !== null) {
    redirect(`/login${search ? `?${search}` : ""}`);
  }

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
