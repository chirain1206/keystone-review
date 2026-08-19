import { envConfig } from "@/lib/env";
import type { AuthUser } from "@/lib/auth/types";

/**
 * 专家白名单（FR-11 增强）：只有 EXPERT_EMAILS（逗号分隔邮箱）里的登录用户
 * 才能提交/审核社区知识。白名单为空时专家功能全部拒绝（安全默认）。
 */

export function getExpertEmails(): Set<string> {
  const raw = envConfig.expertEmails;
  const set = new Set<string>();
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (email) set.add(email);
  }
  return set;
}

/** 邮箱是否在专家白名单（大小写不敏感）。 */
export function isExpert(email: string): boolean {
  return getExpertEmails().has(email.trim().toLowerCase());
}

export type ExpertGate =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

/**
 * 专家门禁（供路由复用）：未登录 401；登录但非白名单 403；白名单放行。
 * 纯函数（不依赖 next/server），便于单测。
 */
export function authorizeExpert(user: AuthUser | null): ExpertGate {
  if (!user) {
    return { ok: false, status: 401, error: "请先登录" };
  }
  if (!isExpert(user.email)) {
    return { ok: false, status: 403, error: "无权限：仅限专家白名单用户访问" };
  }
  return { ok: true };
}
