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
 * 数据访问接口。
 * 实现：
 *  - supabase-repo.ts（生产：Supabase Postgres + RLS，环境变量齐全时启用）
 *  - file-repo.ts（开发/mock：本地 JSON 文件存储，无外部依赖即可跑通全流程）
 *
 * 授权约定：带 userId 参数的方法由实现层保证数据隔离
 * （Supabase 靠 RLS + 显式过滤；file-repo 在内存/文件中过滤）。
 * 服务层仍须校验实体归属（纵深防御，T13 复核）。
 */
export interface Repo {
  // ---- profiles ----
  upsertProfile(p: { id: string; email: string; timezone: string }): Promise<Profile>;
  getProfile(userId: string): Promise<Profile | null>;

  // ---- reports ----
  createReport(input: CreateReportInput): Promise<Report>;
  getReport(userId: string, reportId: string): Promise<Report | null>;
  /** 仅按 id 取报告（服务端内部使用，如分享页只读渲染；不含账户信息） */
  getReportById(reportId: string): Promise<Report | null>;
  listReportsByUser(userId: string): Promise<Report[]>;
  updateReportStatus(reportId: string, status: Report["status"]): Promise<void>;
  /** enrich 完成后写入对比基准元数据（FR-1 两步式：创建时为空，enrich 补齐）。 */
  updateReportCompareMeta(reportId: string, compareMeta: Report["compareMeta"]): Promise<void>;
  /** 属主删除，级联删除 processed_log/chapters/conversations/messages/shares */
  deleteReport(userId: string, reportId: string): Promise<boolean>;

  // ---- processed logs ----
  /** createdAt 由数据层生成，调用方无需提供 */
  saveProcessedLog(record: Omit<ProcessedLogRecord, "createdAt">): Promise<void>;
  getProcessedLog(userId: string, reportId: string): Promise<ProcessedLogRecord | null>;
  getProcessedLogByReportId(reportId: string): Promise<ProcessedLogRecord | null>;

  // ---- chapters ----
  upsertChapter(c: {
    reportId: string;
    chapterNo: number;
    title: string;
    content: string;
    status: ReportChapter["status"];
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  }): Promise<ReportChapter>;
  getChapters(userId: string, reportId: string): Promise<ReportChapter[]>;
  getChaptersByReportId(reportId: string): Promise<ReportChapter[]>;
  getChapter(userId: string, reportId: string, chapterNo: number): Promise<ReportChapter | null>;

  // ---- conversations / messages ----
  createConversation(reportId: string): Promise<Conversation>;
  getConversation(userId: string, conversationId: string): Promise<Conversation | null>;
  addMessage(m: {
    conversationId: string;
    reportId: string;
    role: "user" | "assistant";
    content: string;
    meta?: Message["meta"];
  }): Promise<Message>;
  listMessages(userId: string, reportId: string, conversationId?: string): Promise<Message[]>;
  listMessagesByReportId(reportId: string, conversationId?: string): Promise<Message[]>;
  countUserMessages(conversationId: string): Promise<number>;

  // ---- 每日额度计数（M-3 原子化）----
  /** 原子递增某用户某自然日已用次数，返回递增后的 count（生产走 DB RPC，开发走单进程计数）。 */
  incrementDailyUsage(userId: string, day: string): Promise<number>;

  // ---- shares ----
  createShare(s: {
    reportId: string;
    token: string;
    enabled: boolean;
    expiresAt: number | null;
  }): Promise<Share>;
  getShareByToken(token: string): Promise<Share | null>;
  listShares(userId: string, reportId: string): Promise<Share[]>;
  setShareEnabled(userId: string, reportId: string, token: string, enabled: boolean): Promise<void>;
}
