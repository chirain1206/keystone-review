import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { envConfig } from "@/lib/env";
import type { FeedbackStore } from "@/lib/feedback/store";
import type {
  FeedbackCategory,
  FeedbackCreateInput,
  FeedbackListFilter,
  FeedbackRow,
  FeedbackStatus,
} from "@/lib/feedback/types";

/**
 * 生产反馈存储（FEEDBACK）：Supabase Postgres（迁移 0004）。
 * 服务端经 service role 连接；feedback 无 RLS 且已回收 anon/authenticated
 * 权限 —— 仅服务端私有密钥可访问（见 0004 迁移注释）。
 */
function client(): SupabaseClient {
  return createClient(envConfig.supabaseUrl, envConfig.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const COLS = "id,user_id,email,category,content,page_url,status,created_at";
const DEFAULT_LIMIT = 100;

function toRow(r: Record<string, unknown>): FeedbackRow {
  return {
    id: r.id as string,
    userId: (r.user_id as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    category: r.category as FeedbackCategory,
    content: r.content as string,
    pageUrl: (r.page_url as string | null) ?? null,
    status: r.status as FeedbackStatus,
    createdAt: new Date(r.created_at as string).getTime(),
  };
}

export class SupabaseFeedbackStore implements FeedbackStore {
  async create(input: FeedbackCreateInput): Promise<FeedbackRow> {
    const { data, error } = await client()
      .from("feedback")
      .insert({
        user_id: input.userId,
        email: input.email,
        category: input.category,
        content: input.content,
        page_url: input.pageUrl,
        status: "new",
      })
      .select(COLS)
      .single();
    if (error) throw new Error(`反馈写入失败：${error.message}`);
    if (!data) throw new Error("反馈写入失败：数据库未返回记录");
    return toRow(data);
  }

  async list(filter: FeedbackListFilter = {}): Promise<FeedbackRow[]> {
    let q = client().from("feedback").select(COLS);
    if (filter.status) q = q.eq("status", filter.status);
    q = q
      .order("created_at", { ascending: false })
      .limit(filter.limit && filter.limit > 0 ? filter.limit : DEFAULT_LIMIT);
    const { data, error } = await q;
    if (error) throw new Error(`反馈列表查询失败：${error.message}`);
    return (data ?? []).map(toRow);
  }

  async get(id: string): Promise<FeedbackRow | null> {
    const { data, error } = await client()
      .from("feedback")
      .select(COLS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`反馈查询失败：${error.message}`);
    return data ? toRow(data) : null;
  }

  async updateStatus(id: string, status: FeedbackStatus): Promise<boolean> {
    const { error, count } = await client()
      .from("feedback")
      .update({ status }, { count: "exact" })
      .eq("id", id);
    if (error) throw new Error(`反馈状态更新失败：${error.message}`);
    return (count ?? 0) > 0;
  }
}
