import type { ProcessedLog } from "@/lib/parser/schema";

/**
 * 领域实体（对应 TECH-DESIGN 数据模型的 7 张表）。
 * 无论底层是 Supabase Postgres 还是本地文件存储（mock 模式），
 * 业务层只依赖这些类型与 Repo 接口。
 */

export type SourceType = "file" | "link";
export type ReportStatus = "parsed" | "generating" | "ready" | "failed";
export type ChapterStatus = "pending" | "running" | "done" | "failed";

export const CHAPTER_COUNT = 6;
export const CHAPTER_TITLES = [
  "总体概览",
  "关键时机分析",
  "与顶尖玩家对比",
  "可改进点清单",
  "战术意图识别",
  "下一步练习建议",
] as const;

export interface Profile {
  id: string;
  email: string;
  timezone: string; // IANA，如 Asia/Shanghai（用于"每天 3 次"计数）
  createdAt: number;
}

export interface Report {
  id: string;
  userId: string;
  sourceType: SourceType;
  dungeon: string;
  level: number;
  spec: string;
  playerName: string;
  playerClass: string;
  result: boolean | null; // 限时成功/失败（未知为 null）
  status: ReportStatus;
  compareMeta: {
    url: string;
    title?: string;
    code?: string; // WCL report code
    note?: string;
  } | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProcessedLogRecord {
  reportId: string;
  log: ProcessedLog;
  rawSize: number; // 原始文件字节数
  rawLines: number; // 原始文件行数
  tokenEstimate: number; // 交给 AI 的结构化数据 token 估算
  createdAt: number;
}

export interface ReportChapter {
  id: string;
  reportId: string;
  chapterNo: number; // 1..6
  title: string;
  content: string;
  status: ChapterStatus;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  reportId: string;
  createdAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  reportId: string;
  role: "user" | "assistant";
  content: string;
  meta?: {
    refused?: boolean; // 违规问题被拒绝
    generic?: boolean; // 标记"通用建议，非本场数据"
  };
  createdAt: number;
}

export interface Share {
  id: string;
  reportId: string;
  token: string; // 128-bit 随机（32 hex）
  enabled: boolean;
  createdAt: number;
  expiresAt: number | null;
}

export interface CreateReportInput {
  userId: string;
  sourceType: SourceType;
  dungeon: string;
  level: number;
  spec: string;
  playerName: string;
  playerClass: string;
  result: boolean | null;
  compareMeta?: Report["compareMeta"];
}
