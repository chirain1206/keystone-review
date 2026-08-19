import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildCandidateMarkdown,
  HIGH_CONFIDENCE,
  minePatterns,
  parseMiningLogs,
  writeCandidateFile,
  type CandidateMeta,
} from "@/lib/mining/mine";
import { parseKbFile } from "@/lib/kb/ingest";

/**
 * T20 验收（多 log 交叉挖掘）：
 *  - ≥2 份含重复"宠物提前就位"模式的合成 log + 1 份对照 → 高置信候选 + 证据汇总
 *  - 对照模式不误报
 *  - 产出条目格式满足 ingest 要求（origin=inferred、status=candidate、source_url=internal:inference）
 *  - 幂等
 */

function ts(offsetSec: number): string {
  const total = Math.floor(offsetSec);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const ms = Math.round((offsetSec - total) * 1000);
  return `5/16 21:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

const HUNTER = '"Player-970-00000001"';
const HUNTER_NAME = '"Hunterbeast"';
const PET = '"Pet-0-3764-1"';
const PET_NAME = '"Beast"';
const BOSS = '"Creature-0-3764-1822-28780-127493"';
const BOSS_NAME = '"Mistcaller"';

function hunterCast(offsetSec: number, spell: string): string {
  return `${ts(offsetSec)}  COMBAT_LOG_EVENT,SPELL_CAST_SUCCESS,${HUNTER},${HUNTER_NAME},0x503,0x0,${BOSS},${BOSS_NAME},0xa48,0x0,1,"${spell}",1`;
}
function petMove(offsetSec: number, spell: string): string {
  return `${ts(offsetSec)}  COMBAT_LOG_EVENT,SPELL_CAST_SUCCESS,${PET},${PET_NAME},0x511,0x0,${BOSS},${BOSS_NAME},0xa48,0x0,1,"${spell}",1`;
}
function bossAura(offsetSec: number, applied: boolean): string {
  const type = applied ? "SPELL_AURA_APPLIED" : "SPELL_AURA_REMOVED";
  return `${ts(offsetSec)}  COMBAT_LOG_EVENT,${type},${BOSS},${BOSS_NAME},0xa48,0x0,${BOSS},${BOSS_NAME},0xa48,0x0,270001,"Vulnerable",4,BUFF`;
}

/** 构造含"转阶段前宠物提前就位"的合成 log（phase 在 200s）。 */
function buildPetLog(petMoveOffsets: number[]): string {
  const body: string[] = [
    `${ts(0.1)}  COMBAT_LOG_EVENT,ENCOUNTER_START,1,"Mistcaller",8,5`,
  ];
  // 猎人常规输出（使其成为复盘对象 subject）
  for (let i = 0; i < 12; i++) {
    body.push(hunterCast(5 + i * 15, "Cobra Shot"));
  }
  for (const off of petMoveOffsets) {
    body.push(petMove(off, "Dash"));
  }
  body.push(bossAura(200, true));
  body.push(bossAura(230, false));
  return [
    `${ts(0)}  COMBAT_LOG_EVENT,CHALLENGE_MODE_START,"Mists of Tirna Scithe",15,10,124,134`,
    ...body,
    `${ts(240)}  COMBAT_LOG_EVENT,CHALLENGE_MODE_END,"Mists of Tirna Scithe",15,1`,
  ].join("\n");
}

describe("高阶技巧批量挖掘（T20）", () => {
  it("≥2 份重复模式 + 1 份对照 → 高置信候选 + 证据汇总；对照不误报", () => {
    const logs = [
      ...parseMiningLogs("log1", buildPetLog([178, 182, 186])), // offset -22
      ...parseMiningLogs("log2", buildPetLog([176, 180, 184])), // offset -24
      ...parseMiningLogs("control", buildPetLog([])), // 对照：无宠物提前移动
    ];
    expect(logs).toHaveLength(3);

    const { patterns } = minePatterns(logs);
    const pet = patterns.filter((p) => p.key === "pet-preposition-before-phase");
    expect(pet).toHaveLength(1);
    const p = pet[0];
    expect(p.support).toBe(2); // 仅两份正样本（对照不计入）
    expect(p.total).toBe(3);
    expect(p.confidence).toBeGreaterThanOrEqual(HIGH_CONFIDENCE);
    expect(p.evidence).toContain("2/3");
    expect(p.evidence).toContain("宠物提前就位");
    expect(p.evidence).toContain("±"); // 含容差
    // 偏移归一化：均在阶段前 22~24 秒
    expect(Math.abs(p.meanOffsetSec)).toBeGreaterThanOrEqual(20);
    expect(p.spreadSec).toBeLessThanOrEqual(5);
  });

  it("对照单独不产生任何候选（不误报）", () => {
    const logs = parseMiningLogs("control", buildPetLog([]));
    const { patterns } = minePatterns(logs);
    expect(patterns).toEqual([]);
  });
});

describe("候选条目生成与幂等（T20）", () => {
  const meta: CandidateMeta = {
    class: "Hunter",
    spec: "Beast Mastery",
    dungeon: "Mists of Tirna Scithe",
    patch: "12.1",
  };
  const dir = path.join(os.tmpdir(), `wow-analyzer-mining-test-${Date.now()}`);

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("markdown 满足 ingest 格式（frontmatter + source_url=internal:inference）", () => {
    const logs = [
      ...parseMiningLogs("log1", buildPetLog([178, 182, 186])),
      ...parseMiningLogs("log2", buildPetLog([176, 180, 184])),
    ];
    const p = minePatterns(logs).patterns[0];
    const md = buildCandidateMarkdown(p, meta);
    const parsed = parseKbFile("hunter-mists-pet-preposition.md", md);
    expect(parsed.meta.class).toBe("Hunter");
    expect(parsed.meta.source_url).toBe("internal:inference");
    expect(parsed.meta.type).toBe("intent_pattern");
    expect(parsed.chunks.length).toBe(1);
    expect(parsed.chunks[0].text).toContain("宠物提前就位");
  });

  it("写入 kb/inferred 幂等：重复写入跳过", async () => {
    const logs = [
      ...parseMiningLogs("log1", buildPetLog([178, 182, 186])),
      ...parseMiningLogs("log2", buildPetLog([176, 180, 184])),
    ];
    const p = minePatterns(logs).patterns[0];
    const first = await writeCandidateFile(dir, p, meta);
    const second = await writeCandidateFile(dir, p, meta);
    expect(first.wrote).toBe(true);
    expect(second.wrote).toBe(false); // 幂等
    expect(first.file).toBe(second.file);
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(1);
  });
});
