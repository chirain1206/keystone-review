import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { envConfig } from "@/lib/env";
import type { Repo } from "@/lib/db/repo";
import type {
  Conversation,
  CreateReportInput,
  Message,
  ProcessedLogRecord,
  Profile,
  Report,
  ReportChapter,
  Share,
} from "@/lib/db/types";

/**
 * 生产数据层：Supabase Postgres（T2 迁移脚本建立 7 张表 + RLS）。
 *
 * 安全模型（两层）：
 *  1. 数据库层 RLS（supabase/migrations/0001_init.sql）：浏览器侧 anon key
 *     会话无法跨 user 读写任何行。
 *  2. 应用层：服务端以 service role 连接（仅存在于服务器，永不进浏览器 bundle），
 *     且所有属主操作显式按 user_id 过滤 —— 与 RLS 语义一致的单点隔离，
 *     服务层还会二次校验实体归属（纵深防御，T13）。
 */

function client(): SupabaseClient {
  const c = createClient(envConfig.supabaseUrl, envConfig.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return c;
}

const REPORTS_COLS = "id,user_id,source_type,dungeon,level,spec,player_name,player_class,result,status,compare_meta,created_at,updated_at";

function toReport(r: Record<string, unknown>): Report {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    sourceType: r.source_type as Report["sourceType"],
    dungeon: r.dungeon as string,
    level: r.level as number,
    spec: r.spec as string,
    playerName: r.player_name as string,
    playerClass: r.player_class as string,
    result: r.result as boolean | null,
    status: r.status as Report["status"],
    compareMeta: (r.compare_meta as Report["compareMeta"]) ?? null,
    createdAt: new Date(r.created_at as string).getTime(),
    updatedAt: new Date(r.updated_at as string).getTime(),
  };
}

export class SupabaseRepo implements Repo {
  // ---- profiles ----
  async upsertProfile(p: { id: string; email: string; timezone: string }): Promise<Profile> {
    const { data } = await client()
      .from("profiles")
      .upsert({ id: p.id, email: p.email, timezone: p.timezone })
      .select("*")
      .single();
    return {
      id: data.id,
      email: data.email,
      timezone: data.timezone,
      createdAt: new Date(data.created_at).getTime(),
    };
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const { data } = await client().from("profiles").select("*").eq("id", userId).maybeSingle();
    if (!data) return null;
    return {
      id: data.id,
      email: data.email,
      timezone: data.timezone,
      createdAt: new Date(data.created_at).getTime(),
    };
  }

  // ---- reports ----
  async createReport(input: CreateReportInput): Promise<Report> {
    const { data } = await client()
      .from("reports")
      .insert({
        user_id: input.userId,
        source_type: input.sourceType,
        dungeon: input.dungeon,
        level: input.level,
        spec: input.spec,
        player_name: input.playerName,
        player_class: input.playerClass,
        result: input.result,
        status: "parsed",
        compare_meta: input.compareMeta ?? null,
      })
      .select(REPORTS_COLS)
      .single();
    if (!data) throw new Error("创建报告失败：数据库未返回记录");
    return toReport(data);
  }

  async getReport(userId: string, reportId: string): Promise<Report | null> {
    const { data } = await client()
      .from("reports")
      .select(REPORTS_COLS)
      .eq("id", reportId)
      .eq("user_id", userId)
      .maybeSingle();
    return data ? toReport(data) : null;
  }

  async getReportById(reportId: string): Promise<Report | null> {
    const { data } = await client()
      .from("reports")
      .select(REPORTS_COLS)
      .eq("id", reportId)
      .maybeSingle();
    return data ? toReport(data) : null;
  }

  async listReportsByUser(userId: string): Promise<Report[]> {
    const { data } = await client()
      .from("reports")
      .select(REPORTS_COLS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    return (data ?? []).map(toReport);
  }

  async updateReportStatus(reportId: string, status: Report["status"]): Promise<void> {
    await client()
      .from("reports")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", reportId);
  }

  async deleteReport(userId: string, reportId: string): Promise<boolean> {
    const { count } = await client()
      .from("reports")
      .delete({ count: "exact" })
      .eq("id", reportId)
      .eq("user_id", userId);
    // 级联删除由数据库外键 ON DELETE CASCADE 完成
    return (count ?? 0) > 0;
  }

  // ---- processed logs ----
  async saveProcessedLog(record: Omit<ProcessedLogRecord, "createdAt">): Promise<void> {
    await client().from("processed_logs").upsert({
      report_id: record.reportId,
      events: record.log as unknown as Record<string, unknown>,
      raw_size: record.rawSize,
      raw_lines: record.rawLines,
      token_estimate: record.tokenEstimate,
    });
  }

  async getProcessedLog(userId: string, reportId: string): Promise<ProcessedLogRecord | null> {
    const r = await this.getReport(userId, reportId);
    if (!r) return null;
    return this.getProcessedLogByReportId(reportId);
  }

  async getProcessedLogByReportId(reportId: string): Promise<ProcessedLogRecord | null> {
    const { data } = await client()
      .from("processed_logs")
      .select("*")
      .eq("report_id", reportId)
      .maybeSingle();
    if (!data) return null;
    return {
      reportId: data.report_id,
      log: data.events as ProcessedLogRecord["log"],
      rawSize: data.raw_size,
      rawLines: data.raw_lines,
      tokenEstimate: data.token_estimate,
      createdAt: new Date(data.created_at).getTime(),
    };
  }

  // ---- chapters ----
  async upsertChapter(c: {
    reportId: string;
    chapterNo: number;
    title: string;
    content: string;
    status: ReportChapter["status"];
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  }): Promise<ReportChapter> {
    const { data } = await client()
      .from("report_chapters")
      .upsert(
        {
          report_id: c.reportId,
          chapter_no: c.chapterNo,
          title: c.title,
          content: c.content,
          status: c.status,
          tokens_in: c.tokensIn,
          tokens_out: c.tokensOut,
          cost: c.costUsd,
        },
        { onConflict: "report_id,chapter_no" },
      )
      .select("*")
      .single();
    return {
      id: data.id,
      reportId: data.report_id,
      chapterNo: data.chapter_no,
      title: data.title,
      content: data.content,
      status: data.status,
      tokensIn: data.tokens_in,
      tokensOut: data.tokens_out,
      costUsd: data.cost,
      createdAt: new Date(data.created_at).getTime(),
      updatedAt: new Date(data.updated_at).getTime(),
    };
  }

  async getChapters(userId: string, reportId: string): Promise<ReportChapter[]> {
    const r = await this.getReport(userId, reportId);
    if (!r) return [];
    return this.getChaptersByReportId(reportId);
  }

  async getChaptersByReportId(reportId: string): Promise<ReportChapter[]> {
    const { data } = await client()
      .from("report_chapters")
      .select("*")
      .eq("report_id", reportId)
      .order("chapter_no");
    return (data ?? []).map((c) => ({
      id: c.id,
      reportId: c.report_id,
      chapterNo: c.chapter_no,
      title: c.title,
      content: c.content,
      status: c.status,
      tokensIn: c.tokens_in,
      tokensOut: c.tokens_out,
      costUsd: c.cost,
      createdAt: new Date(c.created_at).getTime(),
      updatedAt: new Date(c.updated_at).getTime(),
    }));
  }

  async getChapter(
    userId: string,
    reportId: string,
    chapterNo: number,
  ): Promise<ReportChapter | null> {
    const chapters = await this.getChapters(userId, reportId);
    return chapters.find((c) => c.chapterNo === chapterNo) ?? null;
  }

  // ---- conversations / messages ----
  async createConversation(reportId: string): Promise<Conversation> {
    const { data } = await client()
      .from("conversations")
      .insert({ report_id: reportId })
      .select("*")
      .single();
    return { id: data.id, reportId: data.report_id, createdAt: new Date(data.created_at).getTime() };
  }

  async getConversation(userId: string, conversationId: string): Promise<Conversation | null> {
    const { data } = await client()
      .from("conversations")
      .select("*, reports!inner(user_id)")
      .eq("id", conversationId)
      .maybeSingle();
    if (!data) return null;
    const ownerId = Array.isArray(data.reports) ? data.reports[0]?.user_id : data.reports?.user_id;
    if (ownerId !== userId) return null;
    return { id: data.id, reportId: data.report_id, createdAt: new Date(data.created_at).getTime() };
  }

  async addMessage(m: {
    conversationId: string;
    reportId: string;
    role: "user" | "assistant";
    content: string;
    meta?: Message["meta"];
  }): Promise<Message> {
    const { data } = await client()
      .from("messages")
      .insert({
        conversation_id: m.conversationId,
        report_id: m.reportId,
        role: m.role,
        content: m.content,
        meta: m.meta ?? null,
      })
      .select("*")
      .single();
    return {
      id: data.id,
      conversationId: data.conversation_id,
      reportId: data.report_id,
      role: data.role,
      content: data.content,
      meta: data.meta,
      createdAt: new Date(data.created_at).getTime(),
    };
  }

  async listMessages(
    userId: string,
    reportId: string,
    conversationId?: string,
  ): Promise<Message[]> {
    const r = await this.getReport(userId, reportId);
    if (!r) return [];
    return this.listMessagesByReportId(reportId, conversationId);
  }

  async listMessagesByReportId(reportId: string, conversationId?: string): Promise<Message[]> {
    let q = client().from("messages").select("*").eq("report_id", reportId);
    if (conversationId) q = q.eq("conversation_id", conversationId);
    const { data } = await q.order("created_at");
    return (data ?? []).map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      reportId: m.report_id,
      role: m.role,
      content: m.content,
      meta: m.meta,
      createdAt: new Date(m.created_at).getTime(),
    }));
  }

  async countUserMessages(conversationId: string): Promise<number> {
    const { count } = await client()
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("role", "user");
    return count ?? 0;
  }

  // ---- shares ----
  async createShare(s: {
    reportId: string;
    token: string;
    enabled: boolean;
    expiresAt: number | null;
  }): Promise<Share> {
    const { data } = await client()
      .from("shares")
      .insert({
        report_id: s.reportId,
        token: s.token,
        enabled: s.enabled,
        expires_at: s.expiresAt ? new Date(s.expiresAt).toISOString() : null,
      })
      .select("*")
      .single();
    return {
      id: data.id,
      reportId: data.report_id,
      token: data.token,
      enabled: data.enabled,
      createdAt: new Date(data.created_at).getTime(),
      expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : null,
    };
  }

  async getShareByToken(token: string): Promise<Share | null> {
    const { data } = await client()
      .from("shares")
      .select("*")
      .eq("token", token)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id,
      reportId: data.report_id,
      token: data.token,
      enabled: data.enabled,
      createdAt: new Date(data.created_at).getTime(),
      expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : null,
    };
  }

  async listShares(userId: string, reportId: string): Promise<Share[]> {
    const r = await this.getReport(userId, reportId);
    if (!r) return [];
    const { data } = await client().from("shares").select("*").eq("report_id", reportId);
    return (data ?? []).map((s) => ({
      id: s.id,
      reportId: s.report_id,
      token: s.token,
      enabled: s.enabled,
      createdAt: new Date(s.created_at).getTime(),
      expiresAt: s.expires_at ? new Date(s.expires_at).getTime() : null,
    }));
  }

  async setShareEnabled(
    userId: string,
    reportId: string,
    token: string,
    enabled: boolean,
  ): Promise<void> {
    const r = await this.getReport(userId, reportId);
    if (!r) return;
    await client()
      .from("shares")
      .update({ enabled })
      .eq("report_id", reportId)
      .eq("token", token);
  }
}
