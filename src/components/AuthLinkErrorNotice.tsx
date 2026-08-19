"use client";

import { useEffect, useState } from "react";
import { parseAuthLinkError } from "@/lib/auth/magic-link";

/**
 * 魔法链接登录失败提示：Supabase 在链接失效 / 过期时重定向到
 * ?error=access_denied&error_code=otp_expired&error_description=...。
 * 命中则在页面顶部显示友好中文提示，并清理 URL 参数（避免刷新重复提示）。
 * 6 位验证码路径不经过 URL 回调、无 error 参数，故此组件不影响该路径。
 */
export default function AuthLinkErrorNotice() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const msg = parseAuthLinkError(window.location.search);
    if (!msg) return;
    setMessage(msg);
    // 只保留 pathname，清掉 query（含 error 参数），避免刷新再次命中提示
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  if (!message) return null;
  return <div className="alert alert-error">{message}</div>;
}
