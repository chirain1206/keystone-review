"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/components/LangProvider";

/**
 * 全局顶栏（T12）：品牌 + 导航 + 登录状态（/api/auth/me）。
 */
interface Me {
  ok: boolean;
  user?: { id: string; email: string };
  isExpert?: boolean;
}

export default function TopBar() {
  const [me, setMe] = useState<Me | null>(null);
  const pathname = usePathname();
  const { lang, setLang } = useLang();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      setMe(await res.json());
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe(null);
    window.location.href = "/";
  };

  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span aria-hidden>⚔️</span> 钥石复盘
      </Link>
      <nav className="nav-links">
        <Link href="/">生成复盘</Link>
        <span className="lang-toggle" role="group" aria-label="界面语言">
          <button
            type="button"
            className={`lang-opt${lang === "zh" ? " lang-active" : ""}`}
            aria-pressed={lang === "zh"}
            onClick={() => setLang("zh")}
          >
            中文
          </button>
          <button
            type="button"
            className={`lang-opt${lang === "en" ? " lang-active" : ""}`}
            aria-pressed={lang === "en"}
            onClick={() => setLang("en")}
          >
            EN
          </button>
        </span>
        {me?.ok ? (
          <>
            <Link href="/history">我的复盘</Link>
            {me.isExpert && <Link href="/expert">知识库</Link>}
            <span style={{ color: "var(--text-dim)" }}>{me.user?.email}</span>
            <button className="btn btn-sm" onClick={logout}>
              登出
            </button>
          </>
        ) : (
          <Link className="btn btn-sm btn-primary" href="/login">
            登录 / 注册
          </Link>
        )}
      </nav>
    </header>
  );
}
