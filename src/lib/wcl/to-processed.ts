import type {
  Aggregate,
  CombatPlayer,
  CombatSummary,
  ProcessedLog,
  TimelineEvent,
  VulnerablePhase,
} from "@/lib/parser/schema";
import { isBossPhaseBuff, isMajorBuff } from "@/lib/parser/keywords";
import { estimateProcessedLogTokens, TOKEN_BUDGET_PER_COMBAT } from "@/lib/ai/tokens";
import type { WclFight } from "@/lib/wcl/adapter";
import type { WclPlayer } from "@/lib/wcl/players";
import type { WclRawEvent } from "@/lib/wcl/events";

/**
 * WCL 事件 → FR-10 结构化数据（ProcessedLog）。
 * 时间语义：WCL 事件 timestamp 为"相对报告起点毫秒"，战斗内秒 = (timestamp - fight.startTime)/1000，
 * t 保留 0.1s 精度；ts 用 "MM:SS.mmm"（链接源无钟表时间，仅展示用）。
 *
 * 事件映射（与 parser.ts 白名单对齐）：
 *  - cooldowns = 玩家爆发/CD/药水（施放 + 增益获得/结束，按 spell@t 去重）
 *  - interrupts = 打断事件（extraAbility = 被断技能）
 *  - deaths = 所选玩家死亡事件
 *  - vulnerablePhases = 敌方易伤类光环 apply→remove 配对（名称白名单，无法确定则留空）
 *  - perMinute / timeline 按可得数据尽力填充
 */

export interface WclToProcessedInput {
  fight: WclFight;
  player: WclPlayer;
  players: WclPlayer[];
  events: WclRawEvent[];
  /** 事件拉取是否达到分页上限（可能不完整）。 */
  truncated?: boolean;
}

const APPLY_TYPES = new Set(["applybuff", "applybuffstack", "refreshbuff"]);
const REMOVE_TYPES = new Set(["removebuff", "removebuffstack"]);

function fightTimeSec(timestamp: number, fightStartMs: number): number {
  return Math.round(((timestamp - fightStartMs) / 1000) * 10) / 10;
}

function formatTs(t: number): string {
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60);
  let ms = Math.round((t - Math.floor(t)) * 1000);
  if (ms >= 1000) ms = 999;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function mkEvent(
  t: number,
  type: TimelineEvent["type"],
  actor: string,
  target?: string,
  spell?: string,
  note?: string,
): TimelineEvent {
  return { t, ts: formatTs(t), type, actor, target, spell, note };
}

function resolveName(
  id: number | undefined,
  side: { name?: string } | undefined,
  byId: Map<number, string>,
): string {
  if (side?.name) return side.name;
  if (id !== undefined) return byId.get(id) ?? `#${id}`;
  return "";
}

export function buildProcessedLogFromWcl(input: WclToProcessedInput): ProcessedLog {
  const { fight, player, players, events, truncated } = input;
  const startMs = fight.startTime ?? 0;
  const byId = new Map<number, string>(players.map((p) => [p.id, p.name]));

  const interrupts: TimelineEvent[] = [];
  const deaths: TimelineEvent[] = [];
  const cooldownMap = new Map<string, TimelineEvent>();
  const bossPhaseEvents: TimelineEvent[] = [];
  const castCounts = new Map<string, { minute: number; player: string; casts: Map<string, number> }>();

  const addCooldown = (e: TimelineEvent, prefer: boolean) => {
    const key = `${e.spell ?? ""}|${Math.round(e.t * 10)}`;
    const existing = cooldownMap.get(key);
    if (!existing || prefer) cooldownMap.set(key, e);
  };

  // ---- Pass 1：打断 / 死亡 / 增益（爆发、易伤）----
  for (const ev of events) {
    const type = ev.type.toLowerCase();
    const t = fightTimeSec(ev.timestamp, startMs);

    if (type === "interrupt") {
      const spell = ev.extraAbility?.name ?? ev.ability?.name;
      interrupts.push(
        mkEvent(
          t,
          "interrupt",
          resolveName(ev.sourceID, ev.source, byId),
          resolveName(ev.targetID, ev.target, byId),
          spell,
          "打断成功",
        ),
      );
      continue;
    }

    if (type === "death") {
      const diedId = ev.targetID;
      const diedName = resolveName(diedId, ev.target, byId);
      // 只收所选玩家（或未知死亡）的死亡；敌方/他人死亡不进个人复盘
      const isPlayer = diedId === player.id || diedName === player.name || diedName === "";
      if (isPlayer) {
        deaths.push(
          mkEvent(
            t,
            "death",
            diedName || player.name,
            resolveName(ev.sourceID, ev.source, byId),
            ev.ability?.name,
            "玩家死亡",
          ),
        );
      }
      continue;
    }

    if (APPLY_TYPES.has(type) || REMOVE_TYPES.has(type)) {
      const spell = ev.ability?.name ?? "";
      const applied = APPLY_TYPES.has(type);
      const targetIsPlayer = ev.targetID === player.id || resolveName(ev.targetID, ev.target, byId) === player.name;

      // 敌方易伤/阶段（名称白名单 + 目标非所选玩家）
      if (isBossPhaseBuff(spell) && !targetIsPlayer) {
        bossPhaseEvents.push(
          mkEvent(t, "boss_phase", resolveName(ev.targetID, ev.target, byId), undefined, spell, applied ? "applied" : "removed"),
        );
        continue;
      }
      // 所选玩家的大招/CD/药水增益
      if (targetIsPlayer && isMajorBuff(spell)) {
        addCooldown(
          mkEvent(t, "buff", player.name, undefined, spell, applied ? "获得增益" : "增益结束"),
          true,
        );
      }
    }
  }

  // ---- Pass 2：施放（爆发/CD/药水施放 + 分钟级聚合）----
  for (const ev of events) {
    const type = ev.type.toLowerCase();
    if (type !== "cast" && type !== "begincast") continue;
    if (ev.sourceID !== player.id) continue;

    const t = fightTimeSec(ev.timestamp, startMs);
    const spell = ev.ability?.name ?? "";
    if (!spell) continue;

    // 分钟级聚合
    const minute = Math.max(0, Math.floor(t / 60));
    const key = `${minute}`;
    let bucket = castCounts.get(key);
    if (!bucket) {
      bucket = { minute, player: player.name, casts: new Map() };
      castCounts.set(key, bucket);
    }
    bucket.casts.set(spell, (bucket.casts.get(spell) ?? 0) + 1);

    // 爆发/CD/药水施放（与增益侧去重，增益优先）
    if (isMajorBuff(spell)) {
      addCooldown(
        mkEvent(
          t,
          "cast",
          player.name,
          undefined,
          spell,
          spell.toLowerCase().includes("potion") ? "使用药水" : "爆发/CD",
        ),
        false,
      );
    }
  }

  // ---- BOSS 易伤窗口（apply→remove 配对）----
  const vulnerablePhases: VulnerablePhase[] = [];
  const openPhase = new Map<string, TimelineEvent>();
  for (const ev of bossPhaseEvents) {
    const key = ev.spell ?? "";
    const prev = openPhase.get(key);
    if (prev && ev.note === "removed") {
      vulnerablePhases.push({ start: prev.t, end: ev.t, note: key });
      openPhase.delete(key);
    } else if (ev.note === "applied") {
      openPhase.set(key, ev);
    }
  }
  for (const [k, ev] of openPhase) {
    vulnerablePhases.push({ start: ev.t, end: ev.t + 60, note: k });
  }

  const cooldowns = [...cooldownMap.values()].sort((a, b) => a.t - b.t);
  const perMinute = [...castCounts.values()]
    .map((b) => ({
      minute: b.minute,
      player: b.player,
      casts: [...b.casts.entries()].map(([spell, count]) => ({ spell, count })),
    }))
    .sort((a, b) => a.minute - b.minute);

  const combatPlayers: CombatPlayer[] = players.map((p) => ({
    name: p.name,
    class: p.class,
    spec: p.spec,
    role: p.role,
  }));

  const combat: CombatSummary = {
    dungeon: fight.name,
    level: fight.keystoneLevel ?? 2,
    // 链接源无绝对钟表时间：start/end 用相对毫秒占位（AI 仅用 durationSec 与 t）
    startTime: 0,
    endTime: fight.durationSec * 1000,
    durationSec: fight.durationSec,
    success: fight.success,
    players: combatPlayers,
    playerName: player.name,
    playerClass: player.class,
    playerSpec: player.spec,
  };

  const aggregate: Aggregate = {
    interrupts,
    deaths,
    cooldowns,
    vulnerablePhases,
    movement: [],
    perMinute,
    truncated,
  };

  const timeline: TimelineEvent[] = [
    ...interrupts,
    ...deaths,
    ...cooldowns,
    ...bossPhaseEvents.map((e) => ({ ...e, type: "boss_phase" as const })),
  ].sort((a, b) => a.t - b.t);

  const log: ProcessedLog = {
    version: 1,
    source: "link",
    combat,
    timeline,
    aggregate,
  };

  // ---- 事件不完整标注（WCL 配额/分页限制）：向时间线注入一条说明，供 AI 如实引用 ----
  if (truncated) {
    log.timeline.unshift({
      t: 0,
      ts: "00:00.000",
      type: "boss_phase",
      actor: fight.name,
      spell: fight.name,
      note: "WCL 链接数据源：事件数据不完整（WCL 配额限制），完整分析请上传日志文件",
    });
  }

  // ---- FR-10 token 预算硬校验（链接源事件少，通常不会触发；防御性保留）----
  if (estimateProcessedLogTokens(log) > TOKEN_BUDGET_PER_COMBAT) {
    log.aggregate.perMinute = log.aggregate.perMinute.map((b) => ({
      ...b,
      casts: b.casts ? b.casts.slice(0, 5) : undefined,
    }));
    log.timeline = log.timeline.filter(
      (e) => e.type === "interrupt" || e.type === "death" || e.type === "boss_phase",
    );
    log.aggregate.truncated = true;
  }

  return log;
}
