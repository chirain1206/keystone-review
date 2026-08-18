import type { ProcessedLog } from "@/lib/parser/schema";
import type { Message } from "@/lib/db/types";

/**
 * 问答提示词与上下文组装（T7，FR-6）。
 *  - 上下文 = 结构化事件切片 + 最近几轮历史（不重复发全量）
 *  - 回答必须引用时间戳/技能证据
 *  - 无法从 log 判断的内容必须说明"通用建议，非本场数据"
 *  - 违规请求礼貌拒绝（与 guard.ts 双保险）
 */

export const QA_SYSTEM_PROMPT = `你是《魔兽世界》大秘境复盘教练的问答助手，只针对"当前这一场战斗日志"回答问题。
回答规则：
1. 简体中文；技能名/专精名/副本名保留游戏内英文原名。
2. 凡引用本场 log 证据，必须给出时间戳（分:秒，与原始日志一致）与技能名；禁止编造数据。
3. 无法从本场 log 判断的内容，必须明确说明"（此为通用建议，不是基于本场数据）"，不得冒充本场证据。
4. 遇到代练、账号交易、陪玩、现金交易、脚本外挂等请求：礼貌拒绝，并说明产品定位是帮助玩家"自己进步"。
5. 结合上文连续追问时保持一致；回答控制在 400 字以内，聚焦问题本身。
6. 用户问跨场/上分等超出本场范围的问题：基于本场数据给出有限建议，并提示"跨场综合分析将在后续版本提供"。`;

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

/** 问答上下文切片（≤ 结构化数据的紧凑视图，控制 token 成本）。 */
export function buildQaContext(log: ProcessedLog): string {
  const c = log.combat;
  const agg = log.aggregate;
  const lines: string[] = [
    `本场：${c.dungeon}（${c.level} 层），时长 ${Math.round(c.durationSec)} 秒，${c.success ? "限时成功" : "未限时完成"}`,
    `队伍：${c.players.map((p) => `${p.name}(${p.class})`).join("、") || "无记录"}`,
    `打断：${agg.interrupts.map((i) => `${fmt(i.t)} ${i.actor} 断 ${i.spell ?? ""}`).join("；") || "无"}`,
    `死亡：${agg.deaths.map((d) => `${fmt(d.t)} ${d.actor}`).join("；") || "无"}`,
    `爆发/CD/药水：${agg.cooldowns.slice(0, 40).map((x) => `${fmt(x.t)} ${x.actor} ${x.spell ?? ""}（${x.note ?? ""}）`).join("；") || "无"}`,
    `易伤窗口：${agg.vulnerablePhases.map((v) => `${fmt(v.start)}–${fmt(v.end)} ${v.note ?? ""}`).join("；") || "无"}`,
  ];
  const recentTimeline = log.timeline
    .filter((e) => e.type === "interrupt" || e.type === "death" || e.type === "boss_phase")
    .slice(0, 60)
    .map((e) => `${fmt(e.t)} ${e.type} ${e.actor} ${e.spell ?? ""}`);
  if (recentTimeline.length) {
    lines.push(`关键时间线（节选）：${recentTimeline.join("；")}`);
  }
  if (agg.truncated) lines.push("（注：原始数据过大已压缩，细节可基于以上聚合回答）");
  return lines.join("\n");
}

/** 组装历史轮次（最近 8 条，防止无限膨胀）。 */
export function buildHistoryBlock(messages: Message[]): string {
  const recent = messages.slice(-8);
  if (recent.length === 0) return "";
  return (
    "此前对话（追问上下文）：\n" +
    recent.map((m) => `${m.role === "user" ? "玩家问" : "教练答"}：${m.content}`).join("\n")
  );
}

export const QA_MAX_ROUNDS = 10;
export const ROUNDS_EXCEEDED_MESSAGE = "本轮对话已结束，可重新开始。";
