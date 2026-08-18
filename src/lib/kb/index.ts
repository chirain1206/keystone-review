import { envConfig, requireProductionEnv } from "@/lib/env";
import type { KbStore } from "@/lib/kb/store";
import { FileKbStore } from "@/lib/kb/file-store";
import { SupabaseKbStore } from "@/lib/kb/supabase-store";

/**
 * 知识库存储工厂（T14）：
 *  - Supabase 环境变量齐全 → SupabaseKbStore（pgvector，迁移 0003）
 *  - 否则 → FileKbStore（开发/mock，关键词匹配）
 * 知识库与业务数据同库，切换逻辑与 getRepo 一致。
 */

let instance: KbStore | null = null;

export function getKbStore(): KbStore {
  if (instance) return instance;
  // 生产 fail-fast：缺 Supabase 密钥直接抛错，禁止静默回退 FileKbStore（M-2）
  requireProductionEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  instance =
    envConfig.supabaseEnabled && envConfig.supabaseServiceRoleKey
      ? new SupabaseKbStore()
      : new FileKbStore();
  return instance;
}

/** 仅测试用：重置单例。 */
export function resetKbStoreForTest(): void {
  instance = null;
}
