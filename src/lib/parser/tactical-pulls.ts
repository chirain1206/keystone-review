import {
  guidType,
  parseChallengeModeStart,
  parseLine,
  type RawEvent,
} from "@/lib/parser/format";

/**
 * T21 战术波还原（chain 检测，FR-12 / ADR-003）。
 *
 * 从原始 log 事件流推断拉怪分组：以"怪物首次进入战斗的毫秒级时间戳"聚类，
 * 并用"上一批怪残血/濒死状态"（死亡事件作为代理）识别 chain 接波 ——
 * 上一批怪进入濒死阶段时新一批怪首次进入战斗 = 新一波（chain）。
 * 产出"战术波"序列（每波怪物清单 + 起止时间）。
 *
 * 动机：WCL 的 pull 分段已把 chain 接波合并（战斗未中断即视为一个 pull），
 * 波次失真的唯一解法是自解析原始 log（详见 TECH-DESIGN ADR-003）。
 *
 * 本模块是独立小结构、按需计算，不写入 FR-10 结构化数据（不影响 token 预算）。
 */

export interface TacticalNpc {
  guid: string;
  name: string;
  /** NPC 标识（GUID 末尾数字段，best-effort；跨实例用 name 做稳定签名） */
  npcId: number | null;
  kind: "trash" | "boss";
}

export interface TacticalPull {
  /** 1-based 波次序号（相对本场战斗） */
  index: number;
  npcs: TacticalNpc[];
  /** 相对战斗开始的毫秒 */
  startMs: number;
  endMs: number;
  startSec: number;
  endSec: number;
  /** 是否由 chain 接波（上一波濒死时接入）形成 */
  chainFromPrev: boolean;
  kind: "trash" | "boss";
}

export interface TacticalRun {
  dungeon: string;
  level: number;
  runStartMs: number; // 绝对（相对文件起始）
  runEndMs: number;
  durationSec: number;
  pulls: TacticalPull[];
}

export interface TacticalPullsResult {
  ok: boolean;
  runs: TacticalRun[];
}

/** 超过该间隔（无新怪进入战斗）视为脱战/自然新一波。 */
export const DROP_GAP_MS = 15_000;
/** 上一波死亡比例达到该阈值且新怪进入战斗 → 判定 chain 接波（新一波）。 */
export const NEAR_DEATH_RATIO = 0.5;

interface CombatEntry {
  guid: string;
  name: string;
  npcId: number | null;
  kind: "trash" | "boss";
  firstMs: number; // 绝对毫秒
  deathMs: number | null; // 绝对毫秒
}

function npcIdFromGuid(guid: string): number | null {
  const m = /(\d+)\s*$/.exec(guid);
  return m ? Number(m[1]) : null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

interface RunAccumulator {
  start: RawEvent;
  end: RawEvent | null;
  events: RawEvent[];
  bossNames: Set<string>;
  zone: string;
}

/** 主入口：解析整段原始日志文本 → 每场大秘境的战术波序列。 */
export function detectTacticalPulls(rawText: string): TacticalPullsResult {
  const runs: TacticalRun[] = [];
  let cur: RunAccumulator | null = null;

  const flush = () => {
    if (!cur) return;
    runs.push(buildRun(cur));
  };

  for (const line of rawText.split("\n")) {
    const ev = parseLine(line);
    if (!ev) continue;
    switch (ev.event) {
      case "CHALLENGE_MODE_START":
        if (cur) flush();
        cur = { start: ev, end: null, events: [], bossNames: new Set(), zone: "" };
        break;
      case "CHALLENGE_MODE_END":
        if (cur) {
          cur.end = ev;
          flush();
          cur = null;
        }
        break;
      case "MAP_CHANGE":
        if (cur && ev.params[0]) cur.zone = ev.params[0];
        break;
      case "ENCOUNTER_START":
        if (cur && ev.params[1]) cur.bossNames.add(ev.params[1]);
        break;
      default:
        break;
    }
    if (cur) cur.events.push(ev);
  }
  if (cur) flush();

  return { ok: runs.length > 0, runs };
}

function buildRun(acc: RunAccumulator): TacticalRun {
  const runStartMs = acc.start.ms;
  const runEndMs = acc.end ? acc.end.ms : (acc.events[acc.events.length - 1]?.ms ?? runStartMs);
  const info = parseChallengeModeStart(acc.start.params);
  const dungeon = acc.zone || info.dungeon || "Unknown Dungeon";
  const level = info.level || 2;

  const entryMap = new Map<string, CombatEntry>();
  const deathMap = new Map<string, number>();

  const touch = (guid: string, name: string, ms: number) => {
    if (guidType(guid) !== "creature" || !name) return;
    const existing = entryMap.get(guid);
    if (existing) {
      if (acc.bossNames.has(name) && existing.kind !== "boss") existing.kind = "boss";
      return;
    }
    entryMap.set(guid, {
      guid,
      name,
      npcId: npcIdFromGuid(guid),
      kind: acc.bossNames.has(name) ? "boss" : "trash",
      firstMs: ms,
      deathMs: null,
    });
  };

  for (const ev of acc.events) {
    const srcGuid = ev.params[0] ?? "";
    const srcName = ev.params[1] ?? "";
    const dstGuid = ev.params[4] ?? "";
    const dstName = ev.params[5] ?? "";

    if (ev.event === "UNIT_DIED" && guidType(dstGuid) === "creature" && dstName) {
      deathMap.set(dstGuid, ev.ms);
      touch(dstGuid, dstName, ev.ms);
    }
    touch(srcGuid, srcName, ev.ms);
    touch(dstGuid, dstName, ev.ms);
  }

  for (const [guid, ms] of deathMap) {
    const e = entryMap.get(guid);
    if (e) e.deathMs = ms;
  }

  const entries = [...entryMap.values()].sort((a, b) => a.firstMs - b.firstMs);

  const pulls: TacticalPull[] = [];
  let current: CombatEntry[] = [];
  let lastEntryMs = 0;
  // 当前（尚未收尾的）波是否为 chain 接波（相对上一波）。在 push 时写入该波。
  let currentIsChain = false;

  const push = () => {
    if (current.length === 0) return;
    const startMs = Math.min(...current.map((n) => n.firstMs)) - runStartMs;
    const dead = current.filter((n) => n.deathMs !== null);
    // 全部死亡 → 以最后死亡时间为波次结束；否则以战斗结束为结束（持续拉怪中）
    const endMs =
      dead.length === current.length
        ? Math.max(...dead.map((n) => n.deathMs!)) - runStartMs
        : runEndMs - runStartMs;
    const kind: TacticalPull["kind"] = current.some((n) => n.kind === "boss") ? "boss" : "trash";
    pulls.push({
      index: pulls.length + 1,
      npcs: current.map((n) => ({ guid: n.guid, name: n.name, npcId: n.npcId, kind: n.kind })),
      startMs,
      endMs,
      startSec: round1(startMs / 1000),
      endSec: round1(endMs / 1000),
      chainFromPrev: currentIsChain,
      kind,
    });
    current = [];
    currentIsChain = false;
  };

  for (const entry of entries) {
    // BOSS 自成一波（作为时间锚点，不与其前后 trash 合并）
    if (entry.kind === "boss") {
      if (current.length > 0) push();
      current.push(entry);
      push();
      continue;
    }

    if (current.length === 0) {
      current.push(entry);
      lastEntryMs = entry.firstMs;
      continue;
    }

    const gap = entry.firstMs - lastEntryMs;
    // 濒死判定只看"到当前新怪进入战斗时为止"已死亡的怪（未来死亡不计入），
    // 否则会把"同一波里稍后自然死亡的怪"误判为 chain 接波。
    const deadCount = current.filter((n) => n.deathMs !== null && n.deathMs <= entry.firstMs).length;
    const nearDeath = deadCount / current.length >= NEAR_DEATH_RATIO;

    if (gap >= DROP_GAP_MS || nearDeath) {
      // chain 接波（上一批濒死时接入）或自然脱战（长时间无新怪）
      push();
      current.push(entry);
      lastEntryMs = entry.firstMs;
      // 新一波是否为 chain：仅当上一批濒死时接入才算 chain（自然脱战不算）
      currentIsChain = nearDeath;
    } else {
      // 上一批仍健康 → 同一波（同一次聚怪）
      current.push(entry);
      lastEntryMs = entry.firstMs;
    }
  }
  if (current.length > 0) push();

  return {
    dungeon,
    level,
    runStartMs,
    runEndMs,
    durationSec: Math.max(0, Math.round((runEndMs - runStartMs) / 1000)),
    pulls,
  };
}
