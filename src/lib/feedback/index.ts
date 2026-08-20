import { envConfig, requireProductionEnv } from "@/lib/env";
import type { FeedbackStore } from "@/lib/feedback/store";
import { FileFeedbackStore } from "@/lib/feedback/file-store";
import { SupabaseFeedbackStore } from "@/lib/feedback/supabase-store";

/**
 * 反馈存储工厂（FEEDBACK）：
 *  - Supabase 环境变量齐全 → SupabaseFeedbackStore（迁移 0004）
 *  - 否则 → FileFeedbackStore（开发/mock，本地 .data/feedback.json）
 * 与 getRepo / getKbStore 同一切换逻辑。
 */

let instance: FeedbackStore | null = null;

export function getFeedbackStore(): FeedbackStore {
  if (instance) return instance;
  // 生产 fail-fast：缺 Supabase 密钥直接抛错，禁止静默回退 FileFeedbackStore（M-2）
  requireProductionEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  instance =
    envConfig.supabaseEnabled && envConfig.supabaseServiceRoleKey
      ? new SupabaseFeedbackStore()
      : new FileFeedbackStore();
  return instance;
}

/** 仅测试用：重置单例。 */
export function resetFeedbackStoreForTest(): void {
  instance = null;
}
