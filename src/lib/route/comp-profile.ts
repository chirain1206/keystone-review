/**
 * T22 阵容画像与相似度（FR-12 / ADR-003）。
 *
 * 按专精属性（伤害类型 / 功能性如战复、嗜血、群控）启发式刻画阵容，
 * 计算阵容相似度 —— 职业构成相似即相似（含可替换职业，如菜刀队中近战互换）。
 * "法刀 / 菜刀 / 混合" 粗标签仅作辅助展示（用户明确不强制二分）。
 *
 * 说明：解析器当前只产出职业（spec 恒为 "Unknown"），因此画像以职业为主；
 * spec 作为可选细化输入预留，未来解析器补全专精后可直接增强。
 */

export interface CompProfile {
  /** 参与画像的职业（游戏原名，去空） */
  classes: string[];
  /** 近战位计数（hybrid 职业各计 0.5） */
  meleeCount: number;
  /** 远程/法系位计数 */
  rangedCount: number;
  /** 功能性标签并集（battle-rez / bloodlust / group-cc …） */
  features: string[];
  /** 辅助粗标签（不强制二分） */
  tag: "法刀" | "菜刀" | "混合";
}

export const COMP_SIMILAR_THRESHOLD = 0.6;

interface ClassAttrs {
  dmg: "melee" | "ranged" | "hybrid";
  features: string[];
}

/** 职业 → 伤害类型 + 功能性启发式表（best-effort，供阵容相似度与可替换判定）。 */
export const CLASS_ATTRS: Record<string, ClassAttrs> = {
  Warrior: { dmg: "melee", features: ["rallying-cry", "battle-shout"] },
  Paladin: { dmg: "melee", features: ["blessing", "immunity", "devotion"] },
  Hunter: { dmg: "ranged", features: ["bloodlust", "misdirect"] },
  Rogue: { dmg: "melee", features: ["shroud", "stun"] },
  Priest: { dmg: "ranged", features: ["power-infusion", "mass-dispel", "fortitude"] },
  "Death Knight": { dmg: "melee", features: ["battle-rez", "grip", "anti-magic-zone"] },
  Shaman: { dmg: "ranged", features: ["bloodlust", "tremor", "stun-totem"] },
  Mage: { dmg: "ranged", features: ["bloodlust", "intellect", "barrier"] },
  Warlock: { dmg: "ranged", features: ["battle-rez", "gateway", "healthstone"] },
  Monk: { dmg: "melee", features: ["ring-of-peace", "mystic-touch", "paralysis"] },
  Druid: { dmg: "hybrid", features: ["battle-rez", "stampeding-roar", "roots", "innervate"] },
  "Demon Hunter": { dmg: "melee", features: ["darkness", "imprison", "magic-debuff"] },
  Evoker: { dmg: "ranged", features: ["bloodlust", "rescue"] },
};

export function buildCompProfile(players: { class: string; spec?: string }[]): CompProfile {
  const features = new Set<string>();
  let melee = 0;
  let ranged = 0;
  const classes: string[] = [];

  for (const p of players) {
    const cls = p.class?.trim();
    if (!cls || cls === "Unknown") continue;
    classes.push(cls);
    const attrs = CLASS_ATTRS[cls] ?? { dmg: "hybrid" as const, features: [] as string[] };
    if (attrs.dmg === "melee") melee += 1;
    else if (attrs.dmg === "ranged") ranged += 1;
    else {
      melee += 0.5;
      ranged += 0.5;
    }
    for (const f of attrs.features) features.add(f);
  }

  const tag: CompProfile["tag"] = ranged >= 3 ? "法刀" : melee >= 3 ? "菜刀" : "混合";
  return { classes, meleeCount: melee, rangedCount: ranged, features: [...features].sort(), tag };
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1 : inter / union;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * 阵容相似度 0–1：
 *  0.7 × 伤害类型构成（近战/远程分布，容忍可替换职业互换）+ 0.3 × 功能性重叠。
 * 菜刀队互换一名近战 → 近战/远程分布不变 → 高相似；
 * 法刀（远程为主）vs 菜刀（近战为主）→ 伤害类型分布差异大 → 低相似。
 */
export function compSimilarity(a: CompProfile, b: CompProfile): number {
  const totalA = a.meleeCount + a.rangedCount;
  const totalB = b.meleeCount + b.rangedCount;
  const denom = Math.max(1, totalA + totalB);
  const dmgSim = 1 - (Math.abs(a.meleeCount - b.meleeCount) + Math.abs(a.rangedCount - b.rangedCount)) / denom;
  const featureSim = jaccard(a.features, b.features);
  return clamp01(0.7 * dmgSim + 0.3 * featureSim);
}
