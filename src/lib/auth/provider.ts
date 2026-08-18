import type { NextRequest, NextResponse } from "next/server";
import { envConfig } from "@/lib/env";
import type { AuthProvider, AuthUser } from "@/lib/auth/types";
import { cookieBridge } from "@/lib/auth/types";
import { MockAuthProvider } from "@/lib/auth/mock-auth";
import { SupabaseAuthProvider } from "@/lib/auth/supabase-auth";

/**
 * 账号工厂：Supabase 环境变量齐全 → SupabaseAuthProvider；
 * 否则 → MockAuthProvider（开发自测）。业务代码零分支。
 */
export function createAuthProvider(req: NextRequest, res: NextResponse): AuthProvider {
  if (envConfig.supabaseEnabled) {
    return new SupabaseAuthProvider(req, res);
  }
  return new MockAuthProvider(cookieBridge(req, res));
}

/** 便捷：读取当前用户（服务端组件/路由处理器通用）。 */
export async function getCurrentUser(req: NextRequest, res: NextResponse): Promise<AuthUser | null> {
  return createAuthProvider(req, res).getSession();
}
