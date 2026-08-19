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
 *  - 写操作 = 锁内"读-改-写"（原子 rename 落盘），并行写互不丢失
 *  - 读操作直读磁盘：Next.js 按路由分包会产生多份模块实例，
 *    直读保证跨路由写后可见
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
  | "shares"
  | "daily_usage";

/** 进程内写互斥：串行化所有落盘操作。 */
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
  try {
    const raw = await fs.readFile(filePath(name), "utf8");
    return JSON.parse(raw) as Record<string, T>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return {} as Record<string, T>;
  }
}

const RENAME_MAX_ATTEMPTS = 3;
const RENAME_BASE_DELAY_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 原子落盘的最后一步 rename。Windows 上若并发读取正持有目标文件句柄，
 * rename 会短暂报 EPERM/EACCES/EBUSY；指数退避重试（50ms → 100ms）吸收
 * 这类瞬时冲突，保留原子写语义（先写 tmp 再 rename，绝不直接覆盖）。
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RENAME_MAX_ATTEMPTS; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw err;
      if (attempt < RENAME_MAX_ATTEMPTS - 1) {
        await sleep(RENAME_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }
  throw lastErr;
}

/** 锁内"读-改-写"：并行调用互不丢失更新。 */
async function mutate<T>(
  name: CollectionName,
  fn: (data: Record<string, T>) => void | Promise<void>,
): Promise<void> {
  await withLock(async () => {
    const data = await load<T>(name);
    await fn(data);
    await fs.mkdir(dataDir(), { recursive: true });
    const tmp = filePath(name) + `.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data), "utf8");
    await renameWithRetry(tmp, filePath(name));
  });
}

function now(): number {
  return Date.now();
}

export class FileRepo implements Repo {
  // ---- profiles ----
  async upsertProfile(p: { id: string; email: string; timezone: string }): Promise<Profile> {
    let profile!: Profile;
    await mutate<Profile>("profiles", (profiles) => {
      const existing = profiles[p.id];
      profile = existing
        ? { ...existing, email: p.email, timezone: p.timezone }
        : { id: p.id, email: p.email, timezone: p.timezone, createdAt: now() };
      profiles[p.id] = profile;
    });
    return profile;
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const profiles = await load<Profile>("profiles");
    return profiles[userId] ?? null;
  }

  // ---- reports ----
  async createReport(input: CreateReportInput): Promise<Report> {
    let report!: Report;
    await mutate<Report>("reports", (reports) => {
      const id = randomUUID();
      report = {
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
        mock: input.mock ?? false,
        createdAt: now(),
        updatedAt: now(),
      };
      reports[id] = report;
    });
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
    await mutate<Report>("reports", (reports) => {
      const r = reports[reportId];
      if (!r) return;
      reports[reportId] = { ...r, status, updatedAt: now() };
    });
  }

  async deleteReport(userId: string, reportId: string): Promise<boolean> {
    const r = await this.getReport(userId, reportId);
    if (!r) return false;

    await mutate<Report>("reports", (reports) => {
      delete reports[reportId];
    });
    await mutate<ProcessedLogRecord>("processed_logs", (logs) => {
      delete logs[reportId];
    });
    await mutate<ReportChapter>("chapters", (chapters) => {
      for (const [k, c] of Object.entries(chapters)) {
        if (c.reportId === reportId) delete chapters[k];
      }
    });
    const convIds = new Set(
      Object.values(await load<Conversation>("conversations"))
        .filter((c) => c.reportId === reportId)
        .map((c) => c.id),
    );
    await mutate<Conversation>("conversations", (convs) => {
      for (const [k, c] of Object.entries(convs)) {
        if (c.reportId === reportId) delete convs[k];
      }
    });
    await mutate<Message>("messages", (messages) => {
      for (const [k, m] of Object.entries(messages)) {
        if (m.reportId === reportId || convIds.has(m.conversationId)) delete messages[k];
      }
    });
    await mutate<Share>("shares", (shares) => {
      for (const [k, s] of Object.entries(shares)) {
        if (s.reportId === reportId) delete shares[k];
      }
    });
    return true;
  }

  // ---- processed logs ----
  async saveProcessedLog(record: Omit<ProcessedLogRecord, "createdAt">): Promise<void> {
    await mutate<ProcessedLogRecord>("processed_logs", (logs) => {
      logs[record.reportId] = { ...record, createdAt: now() };
    });
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
    let chapter!: ReportChapter;
    await mutate<ReportChapter>("chapters", (chapters) => {
      const existing = Object.values(chapters).find(
        (ch) => ch.reportId === c.reportId && ch.chapterNo === c.chapterNo,
      );
      const id = existing?.id ?? randomUUID();
      chapter = {
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
    });
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
    let conv!: Conversation;
    await mutate<Conversation>("conversations", (convs) => {
      const id = randomUUID();
      conv = { id, reportId, createdAt: now() };
      convs[id] = conv;
    });
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
    let msg!: Message;
    await mutate<Message>("messages", (messages) => {
      const id = randomUUID();
      msg = {
        id,
        conversationId: m.conversationId,
        reportId: m.reportId,
        role: m.role,
        content: m.content,
        meta: m.meta,
        createdAt: now(),
      };
      messages[id] = msg;
    });
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

  // ---- 每日额度计数（M-3）----
  // 仅开发/测试用：单进程内计数器（经 withLock 串行化读-改-写，保证本进程原子）。
  // 生产环境由 Supabase RPC increment_daily_usage 原子递增（见 supabase-repo.ts）。
  async incrementDailyUsage(userId: string, day: string): Promise<number> {
    const key = `${userId}:${day}`;
    let count = 0;
    await mutate<number>("daily_usage", (rows) => {
      count = (rows[key] ?? 0) + 1;
      rows[key] = count;
    });
    return count;
  }

  // ---- shares ----
  async createShare(s: {
    reportId: string;
    token: string;
    enabled: boolean;
    expiresAt: number | null;
  }): Promise<Share> {
    let share!: Share;
    await mutate<Share>("shares", (shares) => {
      const id = randomUUID();
      share = {
        id,
        reportId: s.reportId,
        token: s.token,
        enabled: s.enabled,
        createdAt: now(),
        expiresAt: s.expiresAt,
      };
      shares[id] = share;
    });
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
    await mutate<Share>("shares", (shares) => {
      const s = Object.values(shares).find((x) => x.reportId === reportId && x.token === token);
      if (!s) return;
      shares[s.id] = { ...s, enabled };
    });
  }
}
