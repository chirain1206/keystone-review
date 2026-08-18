/**
 * 合成样例日志（测试与本地演示用）。
 * 严格按照 WoWCombatLog.txt 的 COMBAT_LOG_EVENT 公开格式生成：
 *   timestamp  COMBAT_LOG_EVENT,eventName,params...
 * 覆盖场景：
 *  1. mplusSample：一场 15 层 Mists of Tirna Scithe（限时成功，含大量噪声事件）
 *  2. mplusTwoRunsSample：同一文件两场大秘境（战斗列表多选）
 *  3. raidOnlySample：只有团本记录（应提示"暂不支持团本"）
 *  4. invalidSample：普通文本（应提示"不是有效的战斗日志文件"）
 * 样例含 FR-5 战术意图经典案例：5:36 无爆发喝爆发药水（对齐易伤）。
 */

function ts(offsetSec: number): string {
  const total = Math.floor(offsetSec);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const ms = Math.round((offsetSec - total) * 1000);
  return `5/16 ${String(21 + hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

const MAGE = '"Player-970-00000001"';
const MAGE_NAME = '"Mymage"';
const MAGE_FLAGS = "0x511";
const DRUID = '"Player-970-00000002"';
const DRUID_NAME = '"Druidheal"';
const DRUID_FLAGS = "0x512";
const BOSS = '"Creature-0-3764-1822-28780-127493"';
const BOSS_NAME = '"Mistcaller"';
const TRASH = '"Creature-0-3764-1822-28780-127494"';

function cast(offsetSec: number, src: string, srcName: string, dst: string, dstName: string, spellId: number, spellName: string): string {
  return `${ts(offsetSec)}  COMBAT_LOG_EVENT,SPELL_CAST_SUCCESS,${src},${srcName},0x511,0x0,${dst},${dstName},0xa48,0x0,${spellId},"${spellName}",4`;
}
function damage(offsetSec: number, src: string, srcName: string, dst: string, dstName: string, spellName: string, amount: number): string {
  return `${ts(offsetSec)}  COMBAT_LOG_EVENT,SPELL_DAMAGE,${src},${srcName},0x511,0x0,${dst},${dstName},0xa48,0x0,1,"${spellName}",4,${amount},0,0,0,1,0,0,0,0`;
}
function aura(offsetSec: number, applied: boolean, dst: string, dstName: string, spellId: number, spellName: string): string {
  const type = applied ? "SPELL_AURA_APPLIED" : "SPELL_AURA_REMOVED";
  return `${ts(offsetSec)}  COMBAT_LOG_EVENT,${type},${MAGE},${MAGE_NAME},0x511,0x0,${dst},${dstName},0x511,0x0,${spellId},"${spellName}",4,BUFF`;
}
function interrupt(offsetSec: number, src: string, srcName: string, dst: string, dstName: string, interrupted: string): string {
  return `${ts(offsetSec)}  COMBAT_LOG_EVENT,SPELL_INTERRUPT,${src},${srcName},0x511,0x0,${dst},${dstName},0xa48,0x0,2139,"Counterspell",4,1,"${interrupted}",1,BUFF`;
}
function died(offsetSec: number, killer: string, killerName: string, victim: string, victimName: string): string {
  return `${ts(offsetSec)}  COMBAT_LOG_EVENT,UNIT_DIED,${killer},${killerName},0x511,0x0,${victim},${victimName},0x511,0x0`;
}

/** 构造一场带噪声的大秘境战斗（15 层，成功，时长约 12 分钟）。 */
export function buildMythicRunLines(
  startOffsetSec: number,
  dungeon: string,
  level: number,
  success: boolean,
  withNoise = true,
): string[] {
  const lines: string[] = [];
  const t0 = startOffsetSec;
  lines.push(
    `${ts(t0)}  COMBAT_LOG_EVENT,MAP_CHANGE,"${dungeon}","${dungeon}",2222`,
  );
  lines.push(
    `${ts(t0)}  COMBAT_LOG_EVENT,CHALLENGE_MODE_START,"${dungeon}",${level},10,124,134`,
  );
  lines.push(
    `${ts(t0 + 1)}  COMBAT_LOG_EVENT,ENCOUNTER_START,1,"Mistcaller",8,5`,
  );

  // 噪声：环境伤害、无关单位、宠物动作（不应进入关键事件）
  if (withNoise) {
    for (let i = 0; i < 40; i++) {
      lines.push(damage(t0 + 5 + i * 2.1, '"Creature-0-3764-1822-28780-999"', '"Spore"', MAGE, MAGE_NAME, "Rotting Spores", 800 + i * 7));
      lines.push(`${ts(t0 + 5 + i * 2.1 + 0.5)}  COMBAT_LOG_EVENT,SPELL_CAST_SUCCESS,${TRASH},"Spore",0xa48,0x0,${MAGE},${MAGE_NAME},0x511,0x0,1,"Ambient",8`);
    }
  }

  // 常规输出循环（每分钟若干火球术/炎爆术）
  for (let m = 0; m < 11; m++) {
    for (let i = 0; i < 18; i++) {
      const off = t0 + 8 + m * 60 + i * 3;
      lines.push(cast(off, MAGE, MAGE_NAME, BOSS, BOSS_NAME, 133, "Fireball"));
      lines.push(damage(off + 0.4, MAGE, MAGE_NAME, BOSS, BOSS_NAME, "Fireball", 12000 + ((m * 18 + i) % 7) * 900));
      if (i % 6 === 0) {
        lines.push(cast(off + 1, MAGE, MAGE_NAME, BOSS, BOSS_NAME, 11366, "Pyroblast"));
        lines.push(damage(off + 1.4, MAGE, MAGE_NAME, BOSS, BOSS_NAME, "Pyroblast", 48000 + (i % 3) * 2000));
      }
    }
    // 治疗职业常规技能
    lines.push(cast(t0 + 20 + m * 60, DRUID, DRUID_NAME, MAGE, MAGE_NAME, 8936, "Regrowth"));
    lines.push(`${ts(t0 + 20 + m * 60 + 0.3)}  COMBAT_LOG_EVENT,SPELL_HEAL,${DRUID},${DRUID_NAME},0x511,0x0,${MAGE},${MAGE_NAME},0x511,0x0,8936,"Regrowth",8,42000,0,0,0,0,0,0,0,0`);
  }

  // 爆发（2 分钟对齐）
  lines.push(aura(t0 + 125, true, MAGE, MAGE_NAME, 190319, "Combustion"));
  lines.push(aura(t0 + 150, false, MAGE, MAGE_NAME, 190319, "Combustion"));
  lines.push(aura(t0 + 245, true, MAGE, MAGE_NAME, 190319, "Combustion"));
  lines.push(aura(t0 + 270, false, MAGE, MAGE_NAME, 190319, "Combustion"));

  // FR-5 经典案例：5 分 36 秒无爆发时喝爆发药水（对齐 5 分钟后易伤）
  const potionAt = t0 + 336; // 5:36
  lines.push(cast(potionAt, MAGE, MAGE_NAME, MAGE, MAGE_NAME, 307192, "Elemental Potion of Ultimate Power"));
  lines.push(aura(potionAt + 0.5, true, MAGE, MAGE_NAME, 307192, "Elemental Potion of Ultimate Power"));
  lines.push(aura(potionAt + 30, false, MAGE, MAGE_NAME, 307192, "Elemental Potion of Ultimate Power"));
  // 易伤阶段：5 分钟后（10:36 附近）BOSS 进入易伤
  lines.push(aura(t0 + 636, true, BOSS, BOSS_NAME, 270001, "Vulnerable"));
  lines.push(aura(t0 + 671, false, BOSS, BOSS_NAME, 270001, "Vulnerable"));
  lines.push(aura(t0 + 636.5, true, MAGE, MAGE_NAME, 190319, "Combustion"));

  // 打断
  lines.push(interrupt(t0 + 180, MAGE, MAGE_NAME, BOSS, BOSS_NAME, "Bewildering Pollen"));
  lines.push(interrupt(t0 + 300, MAGE, MAGE_NAME, BOSS, BOSS_NAME, "Patty Cake"));
  lines.push(interrupt(t0 + 420, MAGE, MAGE_NAME, BOSS, BOSS_NAME, "Bewildering Pollen"));

  // 死亡（治疗失误案例）
  lines.push(died(t0 + 560, BOSS, BOSS_NAME, MAGE, MAGE_NAME));

  // 结束
  lines.push(`${ts(t0 + 700)}  COMBAT_LOG_EVENT,ENCOUNTER_END,1,"Mistcaller",8,5,1`);
  lines.push(`${ts(t0 + 702)}  COMBAT_LOG_EVENT,CHALLENGE_MODE_END,"${dungeon}",${level},${success ? 1 : 0}`);
  return lines;
}

/** 样例 1：单场大秘境 + 噪声（约 1MB 级可扩展，此处紧凑但结构真实）。 */
export function mplusSample(): string {
  return buildMythicRunLines(0, "Mists of Tirna Scithe", 15, true).join("\n");
}

/** 样例 2：同一文件两场大秘境（战斗列表多选）。 */
export function mplusTwoRunsSample(): string {
  return [
    ...buildMythicRunLines(0, "Mists of Tirna Scithe", 15, true, false),
    ...buildMythicRunLines(720 + 60, "Grim Batol", 12, false, false),
  ].join("\n");
}

/** 样例 3：只有团本记录。 */
export function raidOnlySample(): string {
  return [
    `${ts(0)}  COMBAT_LOG_EVENT,MAP_CHANGE,"Liberation of Undermine","Liberation of Undermine",2217`,
    `${ts(1)}  COMBAT_LOG_EVENT,ENCOUNTER_START,1,"Vexie and the Geargrinders",14,20`,
    ...Array.from({ length: 50 }, (_, i) =>
      damage(2 + i * 1.5, MAGE, MAGE_NAME, '"Creature-0-1-1"', '"Vexie"', "Fireball", 10000 + i),
    ),
    `${ts(90)}  COMBAT_LOG_EVENT,ENCOUNTER_END,1,"Vexie and the Geargrinders",14,20,1`,
  ].join("\n");
}

/** 样例 4：非战斗日志文本。 */
export function invalidSample(): string {
  return [
    "这是一段普通的文本文件内容。",
    "Maybe some random text pretending to be a log.",
    "5/16 21:00:00.000  SOME_OTHER_FORMAT,not,combat,log",
    "",
  ].join("\n");
}

/** 样例 5：纯噪声但无大秘境（有效格式、无任何可分析战斗）。 */
export function noRunsSample(): string {
  return [
    `${ts(0)}  COMBAT_LOG_EVENT,MAP_CHANGE,"Dornogal","Dornogal",2339`,
    ...Array.from({ length: 30 }, (_, i) =>
      damage(1 + i * 2, TRASH, '"Random Mob"', MAGE, MAGE_NAME, "Melee", 500 + i),
    ),
  ].join("\n");
}
