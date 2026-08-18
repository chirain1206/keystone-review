import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
 * Mock/开发模式数据层：本地 JSON 文件存储（.data/ 目录，已 gitignore）。
 * 行为语义与 Supabase 版本保持一致：
 *  - 按 user_id 隔离（实现层过滤）
 *  - 删除 report 级联删除 processed_log/chapters/conversations/messages/shares
 *  - 写入原子化（临时文件 + rename），进程内互斥队列防并发写坏文件
 *
 * 仅用于本地开发与自动化测试；部署阶段配置 Supabase 环境变量后自动切换到
 * supabase-repo.ts（见 db/index.ts）。
 */

/** 每次调用动态解析，测试可通过 DATA_DIR 环境变量重定向。 */
function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
}

type CollectionName =
  | "profiles"
  | "reports"
  | "processed_logs"
  | "chapters"
  | "conversations"
  | "messages"
  | "shares";

const cache = new Map<CollectionName, Record<string, unknown>>();

/** 进程内写互斥：串行化所有落盘操作，避免并发 rename 竞争。 */
let tail: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(
    () => fn(),
    () => fn(),
  );
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function filePath(name: CollectionName): string {
  return path.join(dataDir(), `${name}.json`);
}

async function load<T>(name: CollectionName): Promise<Record<string, T>> {
  if (cache.has(name)) return cache.get(name) as Record<string, T>;
  try {
    const raw = await fs.readFile(filePath(name), "utf8");
    const parsed = JSON.parse(raw) as Record<string, T>;
    cache.set(name, parsed);
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    cache.set(name, {});
    return {} as Record<string, T>;
  }
}

async function persist(name: CollectionName, data: Record<string, unknown>): Promise<void> {
  cache.set(name, data);
  await withLock(async () => {
    await fs.mkdir(dataDir(), { recursive: true });
    const tmp = filePath(name) + `.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data), "utf8");
    await fs.rename(tmp, filePath(name));
  });
}

function now(): number {
  return Date.now();
}

async function updateReportFields(reportId: string, patch: Partial<Report>): Promise<void> {
  const reports = await load<Report>("reports");
  const r = reports[reportId];
  if (!r) return;
  reports[reportId] = { ...r, ...patch, updatedAt: now() };
  await persist("reports", reports);
}

export class FileRepo implements Repo {
  // ---- profiles ----
  async upsertProfile(p: { id: string; email: string; timezone: string }): Promise<Profile> {
    const profiles = await load<Profile>("profiles");
    const existing = profiles[p.id];
    const profile: Profile = existing
      ? { ...existing, email: p.email, timezone: p.timezone }
      : { id: p.id, email: p.email, timezone: p.timezone, createdAt: now() };
    profiles[p.id] = profile;
    await persist("profiles", profiles);
    return profile;
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const profiles = await load<Profile>("profiles");
    return profiles[userId] ?? null;
  }

  // ---- reports ----
  async createReport(input: CreateReportInput): Promise<Report> {
    const reports = await load<Report>("reports");
    const id = randomUUID();
    const report: Report = {
      id,
      userId: input.userId,
      sourceType: input.sourceType,
      dungeon: input.dungeon,
      level: input.level,
      spec: input.spec,
      playerName: input.playerName,
      playerClass: input.playerClass,
      result: input.result,
      status: "parsed",
      compareMeta: input.compareMeta ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    reports[id] = report;
    await persist("reports", reports);
    return report;
  }

  async getReport(userId: string, reportId: string): Promise<Report | null> {
    const reports = await load<Report>("reports");
    const r = reports[reportId];
    return r && r.userId === userId ? r : null;
  }

  async getReportById(reportId: string): Promise<Report | null> {
    const reports = await load<Report>("reports");
    return reports[reportId] ?? null;
  }

  async listReportsByUser(userId: string): Promise<Report[]> {
    const reports = await load<Report>("reports");
    return Object.values(reports)
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async updateReportStatus(reportId: string, status: Report["status"]): Promise<void> {
    await updateReportFields(reportId, { status });
  }

  async deleteReport(userId: string, reportId: string): Promise<boolean> {
    const r = await this.getReport(userId, reportId);
    if (!r) return false;
    // 各集合文件独立原子落盘，顺序执行即可（mock 模式单进程语义）
    const reports = await load<Report>("reports");
    delete reports[reportId];
    await persist("reports", reports);

    const logs = await load<ProcessedLogRecord>("processed_logs");
    delete logs[reportId];
    await persist("processed_logs", logs);

    const chapters = await load<ReportChapter>("chapters");
    for (const [k, c] of Object.entries(chapters)) {
      if (c.reportId === reportId) delete chapters[k];
    }
    await persist("chapters", chapters);

    const convs = await load<Conversation>("conversations");
    const convIds = new Set(
      Object.values(convs)
        .filter((c) => c.reportId === reportId)
        .map((c) => c.id),
    );
    for (const [k, c] of Object.entries(convs)) {
      if (c.reportId === reportId) delete convs[k];
    }
    await persist("conversations", convs);

    const messages = await load<Message>("messages");
    for (const [k, m] of Object.entries(messages)) {
      if (m.reportId === reportId || convIds.has(m.conversationId)) delete messages[k];
    }
    await persist("messages", messages);

    const shares = await load<Share>("shares");
    for (const [k, s] of Object.entries(shares)) {
      if (s.reportId === reportId) delete shares[k];
    }
    await persist("shares", shares);

    return true;
  }

  // ---- processed logs ----
  async saveProcessedLog(record: Omit<ProcessedLogRecord, "createdAt">): Promise<void> {
    const logs = await load<ProcessedLogRecord>("processed_logs");
    logs[record.reportId] = { ...record, createdAt: now() };
    await persist("processed_logs", logs);
  }

  async getProcessedLog(userId: string, reportId: string): Promise<ProcessedLogRecord | null> {
    const r = await this.getReport(userId, reportId);
    if (!r) return null;
    return this.getProcessedLogByReportId(reportId);
  }

  async getProcessedLogByReportId(reportId: string): Promise<ProcessedLogRecord | null> {
    const logs = await load<ProcessedLogRecord>("processed_logs");
    return logs[reportId] ?? null;
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
    const chapters = await load<ReportChapter>("chapters");
    const existing = Object.values(chapters).find(
      (ch) => ch.reportId === c.reportId && ch.chapterNo === c.chapterNo,
    );
    const id = existing?.id ?? randomUUID();
    const chapter: ReportChapter = {
      id,
      reportId: c.reportId,
      chapterNo: c.chapterNo,
      title: c.title,
      content: c.content,
      status: c.status,
      tokensIn: c.tokensIn,
      tokensOut: c.tokensOut,
      costUsd: c.costUsd,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };
    chapters[id] = chapter;
    await persist("chapters", chapters);
    return chapter;
  }

  async getChapters(userId: string, reportId: string): Promise<ReportChapter[]> {
    const r = await this.getReport(userId, reportId);
    if (!r) return [];
    return this.getChaptersByReportId(reportId);
  }

  async getChaptersByReportId(reportId: string): Promise<ReportChapter[]> {
    const chapters = await load<ReportChapter>("chapters");
    return Object.values(chapters)
      .filter((c) => c.reportId === reportId)
      .sort((a, b) => a.chapterNo - b.chapterNo);
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
    const convs = await load<Conversation>("conversations");
    const id = randomUUID();
    const conv: Conversation = { id, reportId, createdAt: now() };
    convs[id] = conv;
    await persist("conversations", convs);
    return conv;
  }

  async getConversation(userId: string, conversationId: string): Promise<Conversation | null> {
    const convs = await load<Conversation>("conversations");
    const conv = convs[conversationId];
    if (!conv) return null;
    const r = await this.getReport(userId, conv.reportId);
    return r ? conv : null;
  }

  async addMessage(m: {
    conversationId: string;
    reportId: string;
    role: "user" | "assistant";
    content: string;
    meta?: Message["meta"];
  }): Promise<Message> {
    const messages = await load<Message>("messages");
    const id = randomUUID();
    const msg: Message = {
      id,
      conversationId: m.conversationId,
      reportId: m.reportId,
      role: m.role,
      content: m.content,
      meta: m.meta,
      createdAt: now(),
    };
    messages[id] = msg;
    await persist("messages", messages);
    return msg;
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
    const messages = await load<Message>("messages");
    return Object.values(messages)
      .filter(
        (m) => m.reportId === reportId && (!conversationId || m.conversationId === conversationId),
      )
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async countUserMessages(conversationId: string): Promise<number> {
    const messages = await load<Message>("messages");
    return Object.values(messages).filter(
      (m) => m.conversationId === conversationId && m.role === "user",
    ).length;
  }

  // ---- shares ----
  async createShare(s: {
    reportId: string;
    token: string;
    enabled: boolean;
    expiresAt: number | null;
  }): Promise<Share> {
    const shares = await load<Share>("shares");
    const id = randomUUID();
    const share: Share = {
      id,
      reportId: s.reportId,
      token: s.token,
      enabled: s.enabled,
      createdAt: now(),
      expiresAt: s.expiresAt,
    };
    shares[id] = share;
    await persist("shares", shares);
    return share;
  }

  async getShareByToken(token: string): Promise<Share | null> {
    const shares = await load<Share>("shares");
    return Object.values(shares).find((s) => s.token === token) ?? null;
  }

  async listShares(userId: string, reportId: string): Promise<Share[]> {
    const r = await this.getReport(userId, reportId);
    if (!r) return [];
    const shares = await load<Share>("shares");
    return Object.values(shares).filter((s) => s.reportId === reportId);
  }

  async setShareEnabled(
    userId: string,
    reportId: string,
    token: string,
    enabled: boolean,
  ): Promise<void> {
    const r = await this.getReport(userId, reportId);
    if (!r) return;
    const shares = await load<Share>("shares");
    const s = Object.values(shares).find((x) => x.reportId === reportId && x.token === token);
    if (!s) return;
    shares[s.id] = { ...s, enabled };
    await persist("shares", shares);
  }
}
