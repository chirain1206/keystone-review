import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getRepo, resetRepoForTest } from "@/lib/db";
import { getKbStore, resetKbStoreForTest } from "@/lib/kb";
import { generateReport } from "@/lib/report/generate";
import { askQuestion } from "@/lib/qa/service";
import type { ProcessedLog } from "@/lib/parser/schema";
import type { KbDocument } from "@/lib/kb/types";

/**
 * T16/T19 端到端：第 5 章与问答的检索注入。
 *  - 注入知识后：领域知识依赖型意图被识别并标注"参考社区攻略"
 *  - 知识解释不了的异常操作 → 疑似高阶技巧（不判失误）
 *  - 疑似沉淀候选：origin=inferred、status=candidate、幂等
 *  - 问答注入知识后带引用标注
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-rag-test-${Date.now()}`);

beforeAll(() => {
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  resetRepoForTest();
  resetKbStoreForTest();
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  resetRepoForTest();
  resetKbStoreForTest();
  await fs.rm(dir, { recursive: true, force: true });
});

function hunterLog(): ProcessedLog {
  return {
    version: 1,
    source: "file",
    combat: {
      dungeon: "Grim Batol",
      level: 12,
      startTime: 0,
      endTime: 500_000,
      durationSec: 500,
      success: true,
      players: [
        { name: "Hunterbeast", class: "Hunter", spec: "Beast Mastery", role: "dps" },
      ],
      playerName: "Hunterbeast",
      playerClass: "Hunter",
      playerSpec: "Beast Mastery",
    },
    timeline: [],
    aggregate: {
      interrupts: [{ t: 300, ts: "5/16 21:05:00.000", type: "interrupt", actor: "Hunterbeast", spell: "Web Bolt", note: "打断成功" }],
      deaths: [],
      cooldowns: [],
      vulnerablePhases: [
        { start: 200, end: 230, note: "Phase Transition" },
        { start: 400, end: 430, note: "Phase Transition" },
      ],
      movement: [
        { t: 175, ts: "5/16 21:02:55.000", type: "movement", actor: "Beast", spell: "Dash" },
        { t: 179, ts: "5/16 21:02:59.000", type: "movement", actor: "Beast", spell: "Follow" },
        { t: 184, ts: "5/16 21:03:04.000", type: "movement", actor: "Beast", spell: "Stay" },
        { t: 380, ts: "5/16 21:06:20.000", type: "movement", actor: "Beast", spell: "Dash" },
        { t: 386, ts: "5/16 21:06:26.000", type: "movement", actor: "Beast", spell: "Stay" },
      ],
      perMinute: [],
    },
  };
}

async function seedKb(): Promise<void> {
  const doc: KbDocument = {
    id: "kb-pet-1",
    chunkText:
      "兽王猎人高阶技巧：转阶段前 25 秒内指挥宠物移动到安全点，规避阶段落地伤害。\n【意图:pet-position-evade】\n{\"kind\":\"pet-preposition\",\"beforeLo\":2,\"beforeHi\":25,\"minMoves\":2}\n【解释】{t} 前后宠物连续位移至固定位置，是「提前指挥宠物规避转阶段伤害」的高阶技巧，判断为正确决策。【/意图】",
    meta: {
      class: "Hunter",
      spec: "Beast Mastery",
      dungeon: "*",
      patch: "12.1",
      type: "intent_pattern",
      source_url: "https://bbs.nga.cn/read.php?tid=46306031",
      origin: "curated",
      status: "active",
    },
    sourceHash: "kb-pet-hash",
    embedding: new Array(1024).fill(0),
  };
  await getKbStore().upsert([doc]);
}

describe("第 5 章检索注入（T16/T19）", () => {
  it("知识解释的异常→意图标注来源；未解释的→疑似；候选落库且幂等", async () => {
    await seedKb();
    const repo = getRepo();
    const report = await repo.createReport({
      userId: "user-a",
      sourceType: "file",
      dungeon: "Grim Batol",
      level: 12,
      spec: "Beast Mastery",
      playerName: "Hunterbeast",
      playerClass: "Hunter",
      result: true,
    });
    await repo.saveProcessedLog({
      reportId: report.id,
      log: hunterLog(),
      rawSize: 100,
      rawLines: 10,
      tokenEstimate: 100,
    });

    const result = await generateReport("user-a", report.id);
    const ch5 = result.chapters.find((c) => c.chapterNo === 5)!;
    expect(ch5.status).toBe("done");

    // 知识解释的第一个宠物位移簇 → 意图 + 来源标注
    expect(ch5.content).toContain("提前指挥宠物规避转阶段伤害");
    expect(ch5.content).toContain("参考社区攻略");
    // 第二个簇知识解释不了 → 疑似高阶技巧，且不判失误
    expect(ch5.content).toContain("疑似高阶技巧");
    expect(ch5.content).toContain("6:20");

    // 候选沉淀：inferred/candidate，正式检索不注入，重复生成幂等
    const candidates = await getKbStore().search(
      { text: "疑似 宠物 就位", vector: [] },
      { class: "Hunter", spec: "Beast Mastery", status: "candidate", patch: null },
      5,
    );
    expect(candidates.length).toBe(1);
    expect(candidates[0].meta.origin).toBe("inferred");
    expect(candidates[0].meta.status).toBe("candidate");

    // 重新生成（章节幂等跳过）→ 不产生第二条候选
    await generateReport("user-a", report.id);
    const again = await getKbStore().search(
      { text: "疑似 宠物 就位", vector: [] },
      { class: "Hunter", spec: "Beast Mastery", status: "candidate", patch: null },
      5,
    );
    expect(again.length).toBe(1);
  });
});

describe("问答检索注入（T16）", () => {
  it("注入知识后回答引用社区攻略", async () => {
    // 与第 5 章共用库：知识块匹配爆发类条件
    await getKbStore().upsert([
      {
        id: "kb-mage-1",
        chunkText:
          "火焰法师打法：开场先交一轮爆发即可，为下一波易伤留资源。\n【意图:hold-burst-next-vuln】\n{\"kind\":\"hold-burst-next-vuln\",\"burstBefore\":130,\"vulnAfter\":90}\n【解释】{t} 的爆发未覆盖任何易伤，是「前快后留」的节奏规划。【/意图】",
        meta: {
          class: "Mage",
          spec: "Fire",
          dungeon: "*",
          patch: "12.1",
          type: "intent_pattern",
          source_url: "https://www.wowhead.com/guide/fire-mage",
          origin: "curated",
          status: "active",
        },
        sourceHash: "kb-mage-hash",
        embedding: new Array(1024).fill(0),
      },
    ]);
    const repo = getRepo();
    const report = await repo.createReport({
      userId: "user-a",
      sourceType: "file",
      dungeon: "Mists of Tirna Scithe",
      level: 15,
      spec: "Fire",
      playerName: "Mymage",
      playerClass: "Mage",
      result: true,
    });
    await repo.saveProcessedLog({
      reportId: report.id,
      log: {
        version: 1,
        source: "file",
        combat: {
          dungeon: "Mists of Tirna Scithe",
          level: 15,
          startTime: 0,
          endTime: 700_000,
          durationSec: 700,
          success: true,
          players: [{ name: "Mymage", class: "Mage", spec: "Fire", role: "dps" }],
          playerName: "Mymage",
          playerClass: "Mage",
          playerSpec: "Fire",
        },
        timeline: [],
        aggregate: {
          interrupts: [],
          deaths: [],
          cooldowns: [{ t: 125, ts: "5/16 21:02:05.000", type: "buff", actor: "Mymage", spell: "Combustion", note: "获得增益" }],
          vulnerablePhases: [{ start: 636, end: 671, note: "Vulnerable" }],
          movement: [],
          perMinute: [],
        },
      },
      rawSize: 100,
      rawLines: 10,
      tokenEstimate: 100,
    });

    const result = await askQuestion("user-a", report.id, "我这波爆发为什么打低了", null);
    expect(result.answer).toContain("参考社区攻略");
    expect(result.answer).toContain("前快后留");
  });
});
