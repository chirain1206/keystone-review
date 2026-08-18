import type {
  Aggregate,
  CombatPlayer,
  CombatSummary,
  ProcessedLog,
  TimelineEvent,
} from "@/lib/parser/schema";
import {
  CLASS_NAMES,
  classIdFromFlags,
  guidType,
  parseBoolParam,
  parseChallengeModeStart,
  parseLine,
  type RawEvent,
} from "@/lib/parser/format";
import { AFFIX_NAMES, isBossPhaseBuff, isMajorBuff } from "@/lib/parser/keywords";
import { estimateProcessedLogTokens, TOKEN_BUDGET_PER_COMBAT, reductionRatio } from "@/lib/ai/tokens";

/**
 * 自研 WoWCombatLog.txt 解析器（T4，FR-2 / FR-10）。
 * 纯函数、无 DOM：可在浏览器 Web Worker 分块喂入，也可在 Node 单测中直接调用。
 *
 * 流程：
 *  1. 校验格式（COMBAT_LOG_EVENT 行数 > 0，否则 INVALID_FILE）
 *  2. 按 CHALLENGE_MODE_START/END 切分大秘境战斗（无则提示不支持团本）
 *  3. 每场战斗按 FR-10 白名单提取关键事件：
 *     打断/死亡/爆发与药水增益/易伤阶段 全量保留；
 *     普通施放与伤害治疗按"分钟 × 玩家"聚合（降噪）；
 *     未命中白名单的 AURA 事件直接丢弃。
 *  4. 时间语义与原始 log 一致（t 为相对战斗开始秒数，ts 保留原始钟表时间）。
 *  5. token 预算硬校验：超过 50K token 逐步压缩，最终保证 ≤ 预算。
 */

export type ParseErrorCode = "INVALID_FILE" | "NO_MYTHIC_RUNS" | "NO_RUNS";

export interface ParseStats {
  rawSize: number; // 原始文本字节数（近似字符数）
  rawLines: number;
  eventLines: number; // 有效 COMBAT_LOG_EVENT 行数
  processedChars: number; // 结构化数据序列化字符数
  tokenEstimate: number; // 结构化数据 token 估算（1 token ≈ 3 字符）
  reductionRatio: number; // 1 - processed/raw（FR-10 辅助指标，要求 ≥90%）
  truncated: boolean; // 是否触发预算压缩
}

export interface ParseResult {
  ok: boolean;
  error?: { code: ParseErrorCode; message: string };
  runs?: CombatRun[];
  stats?: ParseStats;
}

export interface CombatRun {
  combat: CombatSummary;
  timeline: TimelineEvent[];
  aggregate: Aggregate;
  affixes: number[];
}

interface PlayerInfo {
  name: string;
  classId: number | null;
  class: string;
  role: "tank" | "healer" | "dps" | "unknown";
  castCount: number;
  damage: number;
  heal: number;
}

const MOVEMENT_SPELLS = [
  "Blink", "Shimmer", "Sprint", "Dash", "Roll", "Chi Torpedo", "Soulshape",
  "Door of Shadows", "Wild Charge", "Heroic Leap", "Fel Rush", "Infernal Strike",
  "Transcendence", "Gust of Wind", "Disengage", "Grappling Hook", "Shadowstep",
  "Wraith Walk", "Death's Advance", "Tiger Dash", "Stampeding Roar", "Divine Steed",
  "Searing Rush", "Vengeful Retreat", "Deep Breath", "Hover",
];

function mkEvent(ev: RawEvent, runStartMs: number, type: TimelineEvent["type"]): TimelineEvent {
  return {
    t: Math.round(((ev.ms - runStartMs) / 1000) * 10) / 10,
    ts: ev.ts,
    type,
    actor: ev.params[1] ?? "",
    target: ev.params[5] ?? undefined,
    spell: ev.params[9] ?? undefined,
    note: undefined,
  };
}

interface RunAccumulator {
  start: RawEvent | null;
  end: RawEvent | null;
  events: RawEvent[];
  zone: string;
  bossNames: Set<string>;
  players: Map<string, PlayerInfo>;
  interrupts: TimelineEvent[];
  deaths: TimelineEvent[];
  cooldowns: TimelineEvent[];
  movement: TimelineEvent[];
  bossPhaseEvents: TimelineEvent[];
  perMinute: Map<string, { minute: number; player: string; casts: Map<string, number>; damage: number; heal: number }>;
}

function newAccumulator(): RunAccumulator {
  return {
    start: null,
    end: null,
    events: [],
    zone: "",
    bossNames: new Set(),
    players: new Map(),
    interrupts: [],
    deaths: [],
    cooldowns: [],
    movement: [],
    bossPhaseEvents: [],
    perMinute: new Map(),
  };
}

function playerKey(guid: string, name: string): string {
  return `${guid}|${name}`;
}

function playerInfo(name: string, classId: number | null): PlayerInfo {
  return {
    name,
    classId,
    class: classId ? (CLASS_NAMES[classId] ?? "Unknown") : "Unknown",
    role: "unknown",
    castCount: 0,
    damage: 0,
    heal: 0,
  };
}

function parseAmount(params: string[], idx: number): number {
  const v = Number(params[idx]);
  return Number.isFinite(v) ? v : 0;
}

/** 主解析入口。 */
export function parseCombatLog(text: string): ParseResult {
  const rawSize = text.length;
  const rawLines = text.split("\n").length;
  let eventLines = 0;

  // ---- Pass 1：逐行解析 + 分段 ----
  const accs: RunAccumulator[] = [];
  let cur: RunAccumulator | null = null;
  let sawEncounter = false;
  let sawCombatEvent = false;

  for (const line of text.split("\n")) {
    const ev = parseLine(line);
    if (!ev) continue;
    sawCombatEvent = true;
    eventLines++;

    switch (ev.event) {
      case "CHALLENGE_MODE_START": {
        if (cur) finalizeRun(cur); // 防御：未闭合的上局
        cur = newAccumulator();
        cur.start = ev;
        accs.push(cur);
        break;
      }
      case "CHALLENGE_MODE_END": {
        if (cur) {
          cur.end = ev;
          finalizeRun(cur);
          cur = null;
        }
        break;
      }
      case "MAP_CHANGE": {
        const zone = ev.params[0] ?? "";
        if (cur && zone) cur.zone = zone;
        break;
      }
      case "ENCOUNTER_START": {
        sawEncounter = true;
        const boss = ev.params[1];
        if (cur && boss) cur.bossNames.add(boss);
        break;
      }
      case "ENCOUNTER_END":
        sawEncounter = true;
        break;
      default:
        break;
    }

    if (cur) cur.events.push(ev);
  }
  if (cur) {
    finalizeRun(cur);
  }

  // ---- 结果判定 ----
  if (!sawCombatEvent || eventLines === 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_FILE",
        message: "这不是有效的战斗日志文件（未找到 COMBAT_LOG_EVENT 记录），请选择 WoWCombatLog.txt",
      },
    };
  }
  const validRuns = accs.filter((a) => a.start !== null);
  if (validRuns.length === 0) {
    return {
      ok: false,
      error: sawEncounter
        ? { code: "NO_MYTHIC_RUNS", message: "未找到大秘境战斗，第一版暂不支持团本分析" }
        : { code: "NO_RUNS", message: "未找到可分析的战斗记录（缺少大秘境开始/结束事件）" },
    };
  }

  const runs: CombatRun[] = validRuns.map(buildRun);
  const processedChars = JSON.stringify(runs).length;
  const tokenEstimate = estimateProcessedLogTokens(runs);
  const truncated = runs.some((r) => r.aggregate.truncated === true);
  return {
    ok: true,
    runs,
    stats: {
      rawSize,
      rawLines,
      eventLines,
      processedChars,
      tokenEstimate,
      reductionRatio: reductionRatio(rawSize, processedChars),
      truncated,
    },
  };
}

/** 分段收尾：从 start 事件解析副本/层数/词缀。 */
function finalizeRun(acc: RunAccumulator): void {
  if (!acc.start) return;
  const info = parseChallengeModeStart(acc.start.params);
  if (info.dungeon) acc.zone = info.dungeon;
}

/** 单场战斗 → CombatRun。 */
function buildRun(acc: RunAccumulator): CombatRun {
  const start = acc.start!;
  const end = acc.end;
  const startMs = start.ms;
  const endMs = end ? end.ms : (acc.events[acc.events.length - 1]?.ms ?? startMs);

  const info = parseChallengeModeStart(start.params);
  const level = info.level || 0;

  // ---- 提取关键事件 ----
  for (const ev of acc.events) {
    extractEvent(acc, ev, startMs);
  }

  // ---- 玩家与职业 ----
  const playerList: CombatPlayer[] = [];
  for (const p of acc.players.values()) {
    // 角色推定：治疗量远超输出 → healer；承伤最高且职业可坦 → tank（best-effort）
    let role: CombatPlayer["role"] = "dps";
    if (p.heal > 0 && p.heal > p.damage * 1.5) role = "healer";
    playerList.push({ name: p.name, class: p.class, spec: "Unknown", role });
  }
  if (playerList.length > 0) {
    const tankCandidates = playerList.filter((p) =>
      ["Warrior", "Paladin", "Death Knight", "Demon Hunter", "Monk", "Druid"].includes(p.class),
    );
    if (tankCandidates.length === 1) tankCandidates[0].role = "tank";
  }

  // 复盘对象：出场最多（施放最频繁）的玩家 = log 持有者（best-effort）
  const subject =
    [...acc.players.values()].sort((a, b) => b.castCount - a.castCount)[0] ??
    playerInfo("Unknown", null);

  const combat: CombatSummary = {
    dungeon: acc.zone || info.dungeon || "Unknown Dungeon",
    level: level || 2,
    startTime: startMs,
    endTime: endMs,
    durationSec: Math.max(0, Math.round((endMs - startMs) / 1000)),
    success: end ? (parseBoolParam(end.params) ?? false) : false,
    players: playerList,
    playerName: subject.name,
    playerClass: subject.class,
    playerSpec: "Unknown",
  };

  // ---- BOSS 易伤窗口（apply→remove 配对）----
  const vulnerablePhases: { start: number; end: number; note: string }[] = [];
  const openPhase = new Map<string, TimelineEvent>();
  for (const ev of acc.bossPhaseEvents) {
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

  // ---- 分钟级聚合 ----
  const perMinute = [...acc.perMinute.values()]
    .map((b) => ({
      minute: b.minute,
      player: b.player,
      casts: [...b.casts.entries()].map(([spell, count]) => ({ spell, count })),
      damage: Math.round(b.damage),
      heal: Math.round(b.heal),
    }))
    .sort((a, b) => a.minute - b.minute || a.player.localeCompare(b.player));

  const aggregate: Aggregate = {
    interrupts: acc.interrupts,
    deaths: acc.deaths,
    cooldowns: acc.cooldowns,
    vulnerablePhases,
    movement: acc.movement,
    perMinute,
  };

  // ---- 时间线（关键事件按时间排序）----
  const timeline = [
    ...acc.interrupts,
    ...acc.deaths,
    ...acc.cooldowns,
    ...acc.movement,
    ...acc.bossPhaseEvents.map((e) => ({ ...e, type: "boss_phase" as const })),
  ].sort((a, b) => a.t - b.t);

  const run: CombatRun = { combat, timeline, aggregate, affixes: info.affixes };

  // ---- FR-10 token 预算硬校验（逐级压缩）----
  let budget = estimateProcessedLogTokens([run]);
  if (budget > TOKEN_BUDGET_PER_COMBAT) {
    run.aggregate.perMinute = run.aggregate.perMinute.map((b) => ({
      ...b,
      casts: b.casts ? b.casts.slice(0, 5) : undefined,
    }));
    budget = estimateProcessedLogTokens([run]);
  }
  if (budget > TOKEN_BUDGET_PER_COMBAT) {
    // 丢弃非关键时间线事件（保留打断/死亡/易伤/爆发），并把分钟聚合只留合计
    run.timeline = run.timeline.filter(
      (e) => e.type === "interrupt" || e.type === "death" || e.type === "boss_phase",
    );
    run.aggregate.perMinute = run.aggregate.perMinute.map((b) => ({
      minute: b.minute,
      player: b.player,
      damage: b.damage,
      heal: b.heal,
    }));
    budget = estimateProcessedLogTokens([run]);
  }
  if (budget > TOKEN_BUDGET_PER_COMBAT) {
    // 最后手段：每 2 分钟合并聚合桶，时间线按 2 分钟抽样
    run.aggregate.perMinute = mergeBuckets(run.aggregate.perMinute, 2);
    run.timeline = run.timeline.filter((_, i) => i % 2 === 0);
    run.aggregate.truncated = true;
  }
  // 校验最终结果
  const finalBudget = estimateProcessedLogTokens([run]);
  run.aggregate.truncated = run.aggregate.truncated || finalBudget > TOKEN_BUDGET_PER_COMBAT;

  return run;
}

function mergeBuckets(
  buckets: { minute: number; player: string; damage?: number; heal?: number }[],
  span: number,
): { minute: number; player: string; damage?: number; heal?: number }[] {
  const map = new Map<string, { minute: number; player: string; damage: number; heal: number }>();
  for (const b of buckets) {
    const key = `${b.player}#${Math.floor(b.minute / span)}`;
    const e = map.get(key) ?? {
      minute: Math.floor(b.minute / span) * span,
      player: b.player,
      damage: 0,
      heal: 0,
    };
    e.damage += b.damage ?? 0;
    e.heal += b.heal ?? 0;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => a.minute - b.minute);
}

/** 单事件提取（FR-10 白名单）。 */
function extractEvent(acc: RunAccumulator, ev: RawEvent, startMs: number): void {
  const srcGuid = ev.params[0] ?? "";
  const srcName = ev.params[1] ?? "";
  const srcFlags = ev.params[2] ?? "0x0";
  const dstGuid = ev.params[4] ?? "";
  const dstName = ev.params[5] ?? "";
  const dstFlags = ev.params[6] ?? "0x0";

  const srcType = guidType(srcGuid);
  const dstType = guidType(dstGuid);

  // 玩家登记（class 从 flags 尽力提取）
  const registerPlayer = (guid: string, name: string, flagsHex: string) => {
    if (guidType(guid) !== "player" || !name) return;
    const key = playerKey(guid, name);
    if (!acc.players.has(key)) {
      acc.players.set(key, playerInfo(name, classIdFromFlags(flagsHex)));
    }
  };
  registerPlayer(srcGuid, srcName, srcFlags);
  registerPlayer(dstGuid, dstName, dstFlags);

  const isPlayerSrc = srcType === "player" || srcType === "pet";
  const minute = Math.floor((ev.ms - startMs) / 60_000);

  switch (ev.event) {
    case "SPELL_INTERRUPT": {
      // params: src…, dst…, interruptSpellId(8), interruptSpellName(9), school(10), extraSpellId(11), extraSpellName(12), extraSchool(13), auraType(14)
      const interrupted = ev.params[12] ?? ev.params[9] ?? "Unknown";
      const e: TimelineEvent = {
        ...mkEvent(ev, startMs, "interrupt"),
        actor: srcName,
        target: dstName,
        spell: interrupted,
        note: "打断成功",
      };
      acc.interrupts.push(e);
      break;
    }

    case "UNIT_DIED": {
      const diedIsPlayer = dstType === "player";
      const diedIsBoss = acc.bossNames.has(dstName);
      if (!diedIsPlayer && !diedIsBoss) break;
      const e: TimelineEvent = {
        ...mkEvent(ev, startMs, "death"),
        actor: dstName,
        target: srcName || undefined,
        spell: undefined,
        note: diedIsBoss ? "BOSS 死亡" : "玩家死亡",
      };
      acc.deaths.push(e);
      break;
    }

    case "SPELL_CAST_SUCCESS": {
      if (!isPlayerSrc) break;
      const spell = ev.params[9] ?? "";
      const p = acc.players.get(playerKey(srcGuid, srcName));
      if (p) p.castCount++;
      const key = `${srcName}#${minute}`;
      let bucket = acc.perMinute.get(key);
      if (!bucket) {
        bucket = { minute, player: srcName, casts: new Map(), damage: 0, heal: 0 };
        acc.perMinute.set(key, bucket);
      }
      bucket.casts.set(spell, (bucket.casts.get(spell) ?? 0) + 1);

      // 位移技能
      if (MOVEMENT_SPELLS.some((m) => spell.toLowerCase().includes(m.toLowerCase()))) {
        acc.movement.push({ ...mkEvent(ev, startMs, "movement"), actor: srcName, spell });
      }
      // 关键技能（爆发/CD/药水）单列
      if (isMajorBuff(spell)) {
        acc.cooldowns.push({
          ...mkEvent(ev, startMs, "cast"),
          actor: srcName,
          spell,
          note: spell.toLowerCase().includes("potion") ? "使用药水" : "爆发/CD",
        });
      }
      break;
    }

    case "SPELL_AURA_APPLIED":
    case "SPELL_AURA_REMOVED": {
      const spell = ev.params[9] ?? "";
      const applied = ev.event === "SPELL_AURA_APPLIED";
      // BOSS 易伤/阶段 → boss_phase 事件
      if (isBossPhaseBuff(spell) && (dstType === "creature" || acc.bossNames.has(dstName))) {
        acc.bossPhaseEvents.push({
          ...mkEvent(ev, startMs, "boss_phase"),
          actor: dstName,
          spell,
          note: applied ? "applied" : "removed",
        });
        break;
      }
      // 玩家增益白名单（爆发/大减伤/药水）
      if (isMajorBuff(spell) && (dstType === "player" || dstType === "pet")) {
        acc.cooldowns.push({
          ...mkEvent(ev, startMs, "buff"),
          actor: dstName,
          spell,
          note: applied ? "获得增益" : "增益结束",
        });
      }
      break;
    }

    case "SPELL_DAMAGE": {
      if (!isPlayerSrc) break;
      // params: 8 个 GUID 字段后 [8]=spellId [9]=spellName [10]=school [11]=amount
      const amount = parseAmount(ev.params, 11);
      const key = `${srcName}#${minute}`;
      let bucket = acc.perMinute.get(key);
      if (!bucket) {
        bucket = { minute, player: srcName, casts: new Map(), damage: 0, heal: 0 };
        acc.perMinute.set(key, bucket);
      }
      bucket.damage += amount;
      const p = acc.players.get(playerKey(srcGuid, srcName));
      if (p) p.damage += amount;
      break;
    }

    case "SPELL_HEAL": {
      if (!isPlayerSrc) break;
      // params: 同 SPELL_DAMAGE 布局
      const amount = parseAmount(ev.params, 11);
      const key = `${srcName}#${minute}`;
      let bucket = acc.perMinute.get(key);
      if (!bucket) {
        bucket = { minute, player: srcName, casts: new Map(), damage: 0, heal: 0 };
        acc.perMinute.set(key, bucket);
      }
      bucket.heal += amount;
      const p = acc.players.get(playerKey(srcGuid, srcName));
      if (p) p.heal += amount;
      break;
    }

    default:
      break;
  }
}

/** 词缀名称描述（中文说明 + 原名）。 */
export function describeAffixes(affixes: number[]): string {
  if (affixes.length === 0) return "";
  return affixes.map((a) => AFFIX_NAMES[a] ?? `词缀#${a}`).join(" / ");
}

/** 选定战斗 → 可直接提交给服务端的 ProcessedLog。 */
export function toProcessedLog(run: CombatRun, source: "file" | "link"): ProcessedLog {
  return {
    version: 1,
    source,
    combat: run.combat,
    timeline: run.timeline,
    aggregate: run.aggregate,
  };
}
