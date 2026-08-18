/**
 * FR-10 降噪白名单：
 *  - MAJOR_BUFFS：值得单列的增益（爆发/大减伤/团辅/职业大技能，游戏原名）
 *  - 药水：名字含 "Potion" 一律保留
 *  - BOSS 阶段/易伤：名字含关键词一律保留
 *  - 打断、死亡：按事件类型全量保留
 * 未命中的 AURA 事件在时间线中按分钟聚合，不逐条保留。
 */

export const MAJOR_BUFF_SUBSTRINGS: string[] = [
  // 团辅
  "Bloodlust",
  "Heroism",
  "Time Warp",
  "Ancient Hysteria",
  "Fury of the Aspects",
  "Power Infusion",
  "Blessing of Seasons",
  // 法师
  "Combustion",
  "Icy Veins",
  "Arcane Power",
  "Arcane Surge",
  "Rune of Power",
  "Radiant Spark",
  "Touch of the Magi",
  "Mass Barrier",
  "Mass Invisibility",
  "Alter Time",
  // 术士
  "Dark Ascension",
  "Summon Infernal",
  "Summon Darkglare",
  "Summon Demonic Tyrant",
  "Dark Pact",
  "Unending Resolve",
  "Nether Ward",
  // 猎人
  "Bestial Wrath",
  "Aspect of the Wild",
  "Trueshot",
  "Coordinated Assault",
  "Call of the Wild",
  "Camouflage",
  "Exhilaration",
  "Survival of the Fittest",
  "Aspect of the Turtle",
  "Aspect of the Cheetah",
  // 盗贼
  "Adrenaline Rush",
  "Blade Flurry",
  "Shadow Blades",
  "Vendetta",
  "Symbols of Death",
  "Shadow Dance",
  "Evasion",
  "Feint",
  "Cloak of Shadows",
  "Crimson Vial",
  // 武僧
  "Storm, Earth, and Fire",
  "Serenity",
  "Invoke Xuen",
  "Touch of Death",
  "Fortifying Brew",
  "Dampen Harm",
  "Diffuse Magic",
  "Zen Meditation",
  // 德鲁伊
  "Celestial Alignment",
  "Incarnation",
  "Convoke the Spirits",
  "Berserk",
  "Tiger's Fury",
  "Ravenous Frenzy",
  "Bear Form",
  "Ironfur",
  "Frenzied Regeneration",
  "Barkskin",
  "Survival Instincts",
  "Moonkin Form",
  "Innervate",
  "Tranquility",
  "Ironbark",
  "Heart of the Wild",
  // 死亡骑士
  "Pillar of Frost",
  "Breath of Sindragosa",
  "Raise Abomination",
  "Frostwyrm's Fury",
  "Icebound Fortitude",
  "Anti-Magic Shell",
  "Anti-Magic Zone",
  "Lichborne",
  "Vampiric Blood",
  "Dancing Rune Weapon",
  "Rune Tap",
  "Abomination Limb",
  "Unholy Assault",
  // 圣骑士
  "Avenging Wrath",
  "Crusade",
  "Divine Toll",
  "Wake of Ashes",
  "Final Reckoning",
  "Execution Sentence",
  "Guardian of Ancient Kings",
  "Sentinel",
  "Divine Shield",
  "Blessing of Protection",
  "Blessing of Spellwarding",
  "Blessing of Freedom",
  "Lay on Hands",
  "Ardent Defender",
  "Ancient Kings",
  // 战士
  "Avatar",
  "Recklessness",
  "Ravager",
  "Bladestorm",
  "Warbreaker",
  "Colossus Smash",
  "Spear of Bastion",
  "Thunderous Roar",
  "Shield Wall",
  "Last Stand",
  "Demoralizing Shout",
  "Rallying Cry",
  "Spell Reflection",
  "Die by the Sword",
  "Enraged Regeneration",
  "Ignore Pain",
  // 萨满
  "Ascendance",
  "Spiritwalker's Grace",
  "Ancestral Guidance",
  "Spirit Link Totem",
  "Healing Tide Totem",
  "Cloudburst Totem",
  "Stone Bulwark Totem",
  "Astral Shift",
  "Feral Spirit",
  "Primordial Wave",
  "Stormkeeper",
  "Deeply Rooted Elements",
  // 牧师
  "Guardian Spirit",
  "Divine Hymn",
  "Power Word: Barrier",
  "Apotheosis",
  "Vampiric Embrace",
  "Fade",
  "Pain Suppression",
  "Angelic Feather",
  "Voidform",
  "Vampiric Touch",
  "Shadowfiend",
  "Mindbender",
  "Dark Ascension",
  "Shadow Covenant",
  "Divine Ascension",
  "Surge of Light",
  // 恶魔猎手
  "Metamorphosis",
  "The Hunt",
  "Blade Dance",
  "Immolation Aura",
  "Netherwalk",
  "Darkness",
  "Fel Devastation",
  "Fiery Brand",
  // 唤魔师
  "Dragonrage",
  "Tip the Scales",
  "Breath of Eons",
  "Obsidian Scales",
  "Renewing Blaze",
  "Zephyr",
  "Deep Breath",
  "Ebon Might",
  "Fury of the Aspects",
];

export const POTION_MARKERS = ["Potion"];

export const BOSS_PHASE_MARKERS = [
  "Vulnerable",
  "Exposed",
  "Enrage",
  "Phase",
  "Bloodlust of the Fallen",
  "Erupting",
];

/** 词缀 id → 名称（当前资料片常用；未来赛季词缀以数字显示兜底）。 */
export const AFFIX_NAMES: Record<number, string> = {
  3: "Volcanic",
  4: "Necrotic",
  6: "Raging",
  7: "Sanguine",
  8: "Bolstering",
  9: "Tyrannical",
  10: "Fortified",
  11: "Skittish",
  12: "Explosive",
  13: "Bursting",
  14: "Grievous",
  121: "Challenger's Peril",
  122: "Entangling",
  124: "Shielding",
  128: "Incorporeal",
  134: "Afflicted",
  135: "Xal'atath's Bargain",
};

export function isMajorBuff(spellName: string): boolean {
  const n = spellName.toLowerCase();
  if (POTION_MARKERS.some((m) => n.includes(m.toLowerCase()))) return true;
  if (BOSS_PHASE_MARKERS.some((m) => n.includes(m.toLowerCase()))) return true;
  return MAJOR_BUFF_SUBSTRINGS.some((m) => n.includes(m.toLowerCase()));
}

/** 判断一个增益/减益是否为 BOSS 阶段类（用于易伤窗口识别）。 */
export function isBossPhaseBuff(spellName: string): boolean {
  const n = spellName.toLowerCase();
  return BOSS_PHASE_MARKERS.some((m) => n.includes(m.toLowerCase()));
}
