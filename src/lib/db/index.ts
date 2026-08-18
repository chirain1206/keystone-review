import { envConfig, requireProductionEnv } from "@/lib/env";
import type { Repo } from "@/lib/db/repo";
import { FileRepo } from "@/lib/db/file-repo";
import { SupabaseRepo } from "@/lib/db/supabase-repo";

/**
 * 数据层工厂：
 *  - Supabase 环境变量（URL + anon key + service role key）齐全 → SupabaseRepo
 *  - 否则 → FileRepo（mock/开发模式，本地 .data/ JSON 存储）
 * 部署阶段（阶段 5）配置环境变量即可无缝切换，业务代码零改动。
 */

let instance: Repo | null = null;

export function getRepo(): Repo {
  if (instance) return instance;
  // 生产 fail-fast：缺 Supabase 任一密钥直接抛错，禁止静默回退 FileRepo（M-2）
  requireProductionEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  instance =
    envConfig.supabaseEnabled && envConfig.supabaseServiceRoleKey
      ? new SupabaseRepo()
      : new FileRepo();
  return instance;
}

/** 仅测试用：重置单例并清空文件缓存。 */
export function resetRepoForTest(): void {
  instance = null;
}
