/**
 * WoWCombatLog.txt（COMBAT_LOG_EVENT 公开格式）底层解析工具。
 * 纯函数、无 DOM 依赖 —— 主线程 / Web Worker / 单元测试均可使用。
 */

export interface RawEvent {
  ts: string; // 原始时间戳 "M/D HH:MM:SS.mmm"
  ms: number; // 相对文件起始的毫秒偏移（保持时间语义，与原始一致）
  event: string; // SPELL_CAST_SUCCESS / CHALLENGE_MODE_START …
  params: string[]; // 事件参数（已按顶层逗号切分，括号组保持完整）
}

const LINE_RE = /^(\d{1,2})\/(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+COMBAT_LOG_EVENT,\s*(.+)$/;

/** 时间 "M/D HH:MM:SS.mmm" → 毫秒偏移。月份按 30.5 天近似（相对偏移即可）。 */
export function parseTimestamp(ts: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(ts);
  if (!m) return 0;
  const [, month, day, hh, mm, ss, ms] = m;
  const monthDays = (Number(month) - 1) * 30.5 * 86400_000;
  const dayMs = (Number(day) - 1) * 86400_000;
  const timeMs =
    Number(hh) * 3600_000 + Number(mm) * 60_000 + Number(ss) * 1000 + Number(ms);
  return Math.round(monthDays + dayMs + timeMs);
}

/** 顶层逗号切分：忽略引号内与括号组内的逗号。 */
export function splitTopLevelCsv(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      cur += ch;
      if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') {
      inQuote = true;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return t.slice(1, -1);
  return t;
}

/** 解析单行；非 COMBAT_LOG_EVENT 行返回 null。 */
export function parseLine(line: string): RawEvent | null {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const ts = `${m[1]}/${m[2]} ${m[3]}:${m[4]}:${m[5]}.${m[6]}`;
  const rest = splitTopLevelCsv(m[7]);
  if (rest.length === 0) return null;
  const event = stripQuotes(rest[0]);
  const params = rest.slice(1).map(stripQuotes);
  return { ts, ms: parseTimestamp(ts), event, params };
}

/** GUID 工具：判断单位类型。 */
export function guidType(guid: string): "player" | "pet" | "creature" | "vehicle" | "other" {
  if (guid.startsWith("Player-")) return "player";
  if (guid.startsWith("Pet-")) return "pet";
  if (guid.startsWith("Creature-")) return "creature";
  if (guid.startsWith("Vehicle-")) return "vehicle";
  return "other";
}

/** 从 GUID flags 提取职业 id（best-effort，旧格式 0x5xx 低字节为新职业 id 时可能不准）。 */
export function classIdFromFlags(flagsHex: string): number | null {
  const n = parseInt(flagsHex, 16);
  if (Number.isNaN(n)) return null;
  // 玩家单位标志位 0x500；职业在低 8 位（1..13，暴雪职业 id）
  const cls = n & 0xff;
  if (cls >= 1 && cls <= 13) return cls;
  // 兼容旧客户端：0x500 | class 的写法
  const cls2 = n & 0x1f;
  if (cls2 >= 1 && cls2 <= 13) return cls2;
  return null;
}

/** 暴雪职业 id → 游戏原名。 */
export const CLASS_NAMES: Record<number, string> = {
  1: "Warrior",
  2: "Paladin",
  3: "Hunter",
  4: "Rogue",
  5: "Priest",
  6: "Death Knight",
  7: "Shaman",
  8: "Mage",
  9: "Warlock",
  10: "Monk",
  11: "Druid",
  12: "Demon Hunter",
  13: "Evoker",
};

/** 解析 CHALLENGE_MODE_START 的层数与词缀。格式宽松兼容。 */
export function parseChallengeModeStart(
  params: string[],
): { dungeon: string; level: number; affixes: number[] } {
  let dungeon = "";
  let level = 0;
  const affixes: number[] = [];
  for (const p of params) {
    if (/^\d+$/.test(p)) {
      const n = Number(p);
      if (level === 0) level = n;
      else affixes.push(n);
    } else if (!dungeon && p) {
      dungeon = p;
    }
  }
  return { dungeon, level, affixes };
}

/** 布尔型参数（"true"/"false"/"1"/"0"）宽松解析。 */
export function parseBoolParam(params: string[]): boolean | null {
  for (const p of params) {
    if (/^(true|1)$/i.test(p)) return true;
    if (/^(false|0)$/i.test(p)) return false;
  }
  return null;
}
