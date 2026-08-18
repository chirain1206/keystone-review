import { z } from "zod";

/**
 * FR-10 预处理后的结构化数据模型（processed_logs.events 的形状）。
 * 由浏览器端解析器（T4）产出、服务端校验（T13）、AI 管线消费（T5/T7）。
 * 时间语义：所有事件的时间戳必须与原始 log 一致（t 为相对战斗开始的秒数，
 * ts 为原始 log 的钟表时间字符串，保留原样）。
 */

export const KEY_EVENT_TYPES = [
  "cast", // 技能施放（伤害/治疗/爆发）
  "buff", // 增益/减益获得或移除（爆发、药水、饰品）
  "interrupt", // 打断
  "death", // 死亡
  "boss_phase", // BOSS 阶段/易伤变化
  "movement", // 大范围位移（可选事件）
] as const;

export type KeyEventType = (typeof KEY_EVENT_TYPES)[number];

export const timelineEventSchema = z.object({
  t: z.number(), // 相对战斗开始秒数（浮点）
  ts: z.string(), // 原始 log 时间戳（HH:MM:SS.mmm）
  type: z.enum(KEY_EVENT_TYPES),
  actor: z.string(), // 施法者名（玩家/单位）
  target: z.string().optional(),
  spell: z.string().optional(), // 技能原名
  amount: z.number().optional(), // 数值（伤害/治疗/吸收）
  note: z.string().optional(), // 附加说明（如"buff 移除"、"打断成功"）
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export const playerSchema = z.object({
  name: z.string(),
  class: z.string(), // 职业原名（Mage、Paladin…）
  spec: z.string(), // 专精原名（Fire、Protection…）
  role: z.enum(["tank", "healer", "dps", "unknown"]),
});
export type CombatPlayer = z.infer<typeof playerSchema>;

export const combatSummarySchema = z.object({
  dungeon: z.string(), // 副本名（游戏原名优先，可附中文）
  zoneId: z.number().int().optional(),
  level: z.number().int(), // 大秘境层数
  startTime: z.number(), // epoch 毫秒
  endTime: z.number(), // epoch 毫秒
  durationSec: z.number(), // 战斗时长（秒）
  success: z.boolean(), // 限时成功/失败
  players: z.array(playerSchema),
  playerName: z.string(), // 复盘对象（当前用户角色）
  playerClass: z.string(),
  playerSpec: z.string(),
});
export type CombatSummary = z.infer<typeof combatSummarySchema>;

export const vulnerablePhaseSchema = z.object({
  start: z.number(), // 相对秒
  end: z.number(),
  note: z.string(), // 如"BOSS 易伤阶段"
});
export type VulnerablePhase = z.infer<typeof vulnerablePhaseSchema>;

export const aggregateSchema = z.object({
  interrupts: z.array(timelineEventSchema), // 打断事件（含成功/失败）
  deaths: z.array(timelineEventSchema), // 死亡事件
  cooldowns: z.array(timelineEventSchema), // 爆发/CD/药水使用（按时间排序）
  vulnerablePhases: z.array(vulnerablePhaseSchema), // BOSS 易伤/阶段窗口
  movement: z.array(timelineEventSchema), // 大位移事件
});
export type Aggregate = z.infer<typeof aggregateSchema>;

export const processedLogSchema = z.object({
  version: z.literal(1),
  source: z.enum(["file", "link"]),
  combat: combatSummarySchema,
  timeline: z.array(timelineEventSchema), // 全量关键事件时间线（按 t 排序）
  aggregate: aggregateSchema,
});
export type ProcessedLog = z.infer<typeof processedLogSchema>;

/** 校验解析器输出；失败时返回可读中文错误列表。 */
export function validateProcessedLog(input: unknown): {
  ok: boolean;
  log?: ProcessedLog;
  errors?: string[];
} {
  const r = processedLogSchema.safeParse(input);
  if (r.success) return { ok: true, log: r.data };
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}
