import type { CombatPlayer } from "@/lib/parser/schema";

/**
 * WCL 报告玩家列表的纯函数工具（FR-1/FR-3 扩展，事件级数据）。
 * 无网络依赖，便于单测覆盖"角色列表返回 + 上传者预选"。
 *
 * 数据来源（WCL v2 GraphQL，字段名已对照官方 schema 核实）：
 *  - masterData.actors(type: "Player") → id / name / subType(职业)
 *  - fights.friendlyPlayers + friendlySpecs（一一对应）→ 每场战斗的玩家 id 与专精
 *  - report.owner.name → 报告上传者（WCL 账号名，best-effort 匹配角色）
 */

export interface WclPlayer {
  /** 报告内 actor id（事件里的 sourceID/targetID 用这个）。 */
  id: number;
  name: string;
  /** 职业原名（Mage、Paladin…）。 */
  class: string;
  /** 专精原名（Fire、Protection…）；未识别为 "Unknown"。 */
  spec: string;
  role: CombatPlayer["role"];
  /** true = 判定为报告上传者角色（best-effort）。 */
  isUploader?: boolean;
}

export interface WclActor {
  id?: number | null;
  name?: string | null;
  /** 对玩家而言是职业名（"Mage"）。 */
  subType?: string | null;
  type?: string | null;
}

export interface WclFightPlayers {
  id?: number | null;
  /** 与 friendlySpecs 一一对应的玩家 actor id。 */
  friendlyPlayers?: number[] | null;
  friendlySpecs?: string[] | null;
}

/** 坦克专精（决定 role）。 */
const TANK_SPECS = new Set([
  "Blood",
  "Vengeance",
  "Guardian",
  "Brewmaster",
  "Protection",
]);

/** 治疗专精（决定 role）。 */
const HEALER_SPECS = new Set([
  "Restoration",
  "Holy",
  "Discipline",
  "Mistweaver",
  "Preservation",
]);

/** 专精名 → 角色定位（FR-10 role）。未知专精归 dps（M+ 队伍默认 3 DPS）。 */
export function specToRole(spec: string): CombatPlayer["role"] {
  if (!spec || spec === "Unknown") return "unknown";
  if (TANK_SPECS.has(spec)) return "tank";
  if (HEALER_SPECS.has(spec)) return "healer";
  return "dps";
}

/** 名字归一化（大小写不敏感，忽略多余空格与全角空格）。 */
function normName(name: string): string {
  return name.trim().toLowerCase().replace(/\u3000/g, " ");
}

/**
 * 合并 actor（id/name/class）与每场战斗的专精，产出报告玩家列表。
 * 专精取首个非空出现的战斗；上传者按名字 best-effort 标记。
 */
export function buildPlayers(
  actors: WclActor[],
  fights: WclFightPlayers[],
  ownerName?: string | null,
): { players: WclPlayer[]; uploaderName?: string } {
  // id → spec（首见非空生效）
  const specById = new Map<number, string>();
  for (const f of fights) {
    const ids = f.friendlyPlayers ?? [];
    const specs = f.friendlySpecs ?? [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id === undefined || id === null) continue;
      const spec = specs[i];
      if (spec && !specById.has(id)) specById.set(id, spec);
    }
  }

  const byId = new Map<number, WclPlayer>();
  const seenNames = new Set<string>();
  const push = (p: WclPlayer) => {
    if (byId.has(p.id)) return;
    if (seenNames.has(normName(p.name))) return;
    byId.set(p.id, p);
    seenNames.add(normName(p.name));
  };

  for (const a of actors) {
    if (!a.name) continue;
    // masterData 可能混入 Pet/NPC；玩家 subType 为职业名，Pet 的 type 是 "Pet"
    if (a.type && a.type !== "Player" && a.type !== "Unknown") continue;
    const id = a.id ?? 0;
    const spec = specById.get(id) ?? "Unknown";
    push({
      id,
      name: a.name,
      class: a.subType && a.subType !== "Unknown" ? a.subType : "Unknown",
      spec,
      role: specToRole(spec),
    });
  }
  // 兜底：某些报告 friendlyPlayers 的 id 不在 actors（极少见）—— 用 spec 侧兜底名占位
  for (const [id, spec] of specById) {
    if (!byId.has(id)) {
      push({
        id,
        name: `Player#${id}`,
        class: "Unknown",
        spec,
        role: specToRole(spec),
      });
    }
  }

  const players = [...byId.values()];
  let uploaderName: string | undefined;
  if (ownerName) {
    const hit = players.find((p) => normName(p.name) === normName(ownerName));
    if (hit) {
      hit.isUploader = true;
      uploaderName = hit.name;
    }
  }
  return { players, uploaderName };
}

/**
 * 预选复盘对象：优先上传者，否则第一个玩家；无玩家返回 undefined。
 */
export function preselectPlayerId(
  players: WclPlayer[],
  uploaderName?: string | null,
): number | undefined {
  if (players.length === 0) return undefined;
  const up = players.find((p) => p.isUploader === true);
  if (up) return up.id;
  if (uploaderName) {
    const byName = players.find((p) => normName(p.name) === normName(uploaderName));
    if (byName) return byName.id;
  }
  return players[0].id;
}

/**
 * 按某场战斗的参与者过滤出该场实际参与的玩家（复盘对象候选）。
 *
 * 依据：WCL v2 GraphQL Fight.friendlyPlayers 返回该场战斗的玩家 actor id 列表
 * （与 friendlySpecs 一一对应；已用真实报告探测确认，见完成回报"字段核实结论"）。
 * 一份报告可能含多场大秘境、每场参与玩家不同——全报告玩家列表会混入其他场次的队员，
 * 故复盘对象必须按所选场次过滤。
 *
 * 拿不到 fight 级玩家信息（字段缺失/为空）或过滤结果为空时，回退整份报告玩家列表，
 * 保证在旧报告/异常数据下仍可用（不阻塞流程）。
 */
export function filterPlayersByFight<T extends { id: number }>(
  players: T[],
  friendlyPlayers?: number[] | null,
): T[] {
  if (!friendlyPlayers || friendlyPlayers.length === 0) return players;
  const ids = new Set(friendlyPlayers);
  const filtered = players.filter((p) => ids.has(p.id));
  return filtered.length > 0 ? filtered : players;
}

/**
 * 按某场战斗的 friendlyPlayers/friendlySpecs（同索引一一对应）覆盖玩家专精。
 *
 * 修复"跨场次换专精错配"：buildPlayers 产出的 spec 是**跨全部场次**按"首见非空生效"，
 * 同一角色在不同场次换了专精时（如某场野性德、某场平衡德）会错配成首见的那个。
 * 本函数**按所选场次**用 friendlyPlayers 的 id 连接 masterData 玩家，专精取同索引的
 * friendlySpecs（禁止按数组下标跨列表配对），覆盖回正确专精。
 * 返回新数组，不改动入参；无 fight 级专精信息时原样返回。
 */
export function applyFightSpecs<T extends { id: number; spec: string }>(
  players: readonly T[],
  friendlyPlayers: readonly (number | null | undefined)[] | null | undefined,
  friendlySpecs: readonly (string | null | undefined)[] | null | undefined,
): T[] {
  const ids = friendlyPlayers ?? [];
  const specs = friendlySpecs ?? [];
  const specById = new Map<number, string>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const spec = specs[i];
    if (id !== undefined && id !== null && spec) specById.set(id, spec);
  }
  if (specById.size === 0) return [...players];
  return players.map((p) => {
    const spec = specById.get(p.id);
    return spec ? { ...p, spec } : p;
  });
}

/** mock：固定 5 人小队（无 WCL 密钥时的演示数据），DemoMage 标记为上传者。 */
export function mockPlayers(): WclPlayer[] {
  return [
    { id: 1, name: "DemoTank", class: "Warrior", spec: "Protection", role: "tank" },
    { id: 2, name: "DemoHealer", class: "Shaman", spec: "Restoration", role: "healer" },
    { id: 3, name: "DemoMage", class: "Mage", spec: "Fire", role: "dps", isUploader: true },
    { id: 4, name: "DemoRogue", class: "Rogue", spec: "Assassination", role: "dps" },
    { id: 5, name: "DemoDruid", class: "Druid", spec: "Balance", role: "dps" },
  ];
}
