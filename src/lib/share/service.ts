import { randomBytes } from "node:crypto";
import { getRepo } from "@/lib/db";
import type { ReportChapter, Share } from "@/lib/db/types";

/**
 * 一键分享（T11，FR-9）。
 *  - token 为 128-bit 随机（32 位 hex），不可枚举
 *  - 可随时关闭（原链接立即失效）
 *  - 公开页只读：不含邮箱/历史列表等任何账户信息
 */

export interface PublicShareData {
  share: Share;
  report: {
    id: string;
    dungeon: string;
    level: number;
    spec: string;
    playerName: string;
    playerClass: string;
    result: boolean | null;
    status: string;
    createdAt: number;
  };
  chapters: Pick<ReportChapter, "chapterNo" | "title" | "content" | "status">[];
  messages: { role: string; content: string; createdAt: number }[];
}

export function generateShareToken(): string {
  // 128-bit 随机数 → 32 位 hex
  return randomBytes(16).toString("hex");
}

/** 开启分享：已有分享则复用（禁用的重新启用），否则新建。 */
export async function createOrGetShare(
  userId: string,
  reportId: string,
): Promise<{ ok: boolean; share?: Share; error?: string }> {
  const repo = getRepo();
  const report = await repo.getReport(userId, reportId);
  if (!report) return { ok: false, error: "复盘不存在" };

  const existing = await repo.listShares(userId, reportId);
  if (existing.length > 0) {
    const s = existing[0];
    if (!s.enabled) await repo.setShareEnabled(userId, reportId, s.token, true);
    return { ok: true, share: { ...s, enabled: true } };
  }
  const share = await repo.createShare({
    reportId,
    token: generateShareToken(),
    enabled: true,
    expiresAt: null,
  });
  return { ok: true, share };
}

/** 关闭分享：原链接立即失效。 */
export async function disableShare(userId: string, reportId: string): Promise<{ ok: boolean; error?: string }> {
  const repo = getRepo();
  const report = await repo.getReport(userId, reportId);
  if (!report) return { ok: false, error: "复盘不存在" };
  const shares = await repo.listShares(userId, reportId);
  for (const s of shares) {
    if (s.enabled) await repo.setShareEnabled(userId, reportId, s.token, false);
  }
  return { ok: true };
}

/** 公开只读读取（免登录）：token 校验 + enabled + 未过期。 */
export async function getPublicShareData(token: string): Promise<PublicShareData | null> {
  const repo = getRepo();
  const share = await repo.getShareByToken(token);
  if (!share || !share.enabled) return null;
  if (share.expiresAt && share.expiresAt <= Date.now()) return null;

  const report = await repo.getReportById(share.reportId);
  if (!report) return null;
  const chapters = await repo.getChaptersByReportId(share.reportId);
  const messages = await repo.listMessagesByReportId(share.reportId);

  return {
    share,
    report: {
      id: report.id,
      dungeon: report.dungeon,
      level: report.level,
      spec: report.spec,
      playerName: report.playerName,
      playerClass: report.playerClass,
      result: report.result,
      status: report.status,
      createdAt: report.createdAt,
    },
    chapters: chapters.map((c) => ({
      chapterNo: c.chapterNo,
      title: c.title,
      content: c.content,
      status: c.status,
    })),
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
  };
}
