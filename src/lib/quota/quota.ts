import { getRepo } from "@/lib/db";

/**
 * 免费额度（T9，FR-7 额度部分）：
 * 每个账号每天（自然日，按用户所在时区）可生成 3 次复盘。
 * 第 4 次被拒，提示"今日次数已用完，明天再来；深度复盘即将上线"。
 * 第一版不提供付费扣款。
 */

export const DAILY_REPORT_LIMIT = 3;
export const QUOTA_EXHAUSTED_MESSAGE =
  "今日次数已用完，明天再来；深度复盘即将上线";

const dayKeyFormatterCache = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dayKeyFormatterCache.get(timeZone);
  if (!f) {
    // en-CA 输出 YYYY-MM-DD
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayKeyFormatterCache.set(timeZone, f);
  }
  return f;
}

/** 某一时刻在用户时区下的自然日 key（YYYY-MM-DD）。 */
export function dayKey(nowMs: number, timeZone: string): string {
  return dayFormatter(timeZone).format(new Date(nowMs));
}

/** 用户时区下下一个自然日边界的 epoch 毫秒（"明天几点恢复"）。 */
export function nextDayBoundaryMs(nowMs: number, timeZone: string): number {
  const today = dayKey(nowMs, timeZone);
  let lo = nowMs + 60_000;
  let hi = nowMs + 36 * 3600_000; // 最长时区差 + 1 天，必越过边界
  while (hi - lo > 1000) {
    const mid = (lo + hi) / 2;
    if (dayKey(mid, timeZone) === today) lo = mid;
    else hi = mid;
  }
  return Math.ceil(hi / 1000) * 1000;
}

export interface QuotaCheck {
  allowed: boolean;
  used: number;
  limit: number;
  /** 恢复时间（epoch ms，对应"明天"的 0 点） */
  resetAt: number;
}

/** 检查当日额度（按用户时区自然日统计 report 创建数）。 */
export async function checkDailyQuota(
  userId: string,
  timeZone: string,
  nowMs: number = Date.now(),
): Promise<QuotaCheck> {
  const today = dayKey(nowMs, timeZone);
  const reports = await getRepo().listReportsByUser(userId);
  const used = reports.filter((r) => dayKey(r.createdAt, timeZone) === today).length;
  return {
    allowed: used < DAILY_REPORT_LIMIT,
    used,
    limit: DAILY_REPORT_LIMIT,
    resetAt: nextDayBoundaryMs(nowMs, timeZone),
  };
}
