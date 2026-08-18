import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getKbStore, resetKbStoreForTest } from "@/lib/kb";
import { persistSuspectedCandidates, candidateSourceHash } from "@/lib/kb/candidates";
import { runSuspectedTechniqueDetection } from "@/lib/ai/intent-engine";

/**
 * T19 验收（疑似高阶技巧沉淀）：
 *  - 疑似判定（宠物提前就位样例）：判"疑似"而非"失误"
 *  - 候选落库：origin=inferred、status=candidate，可查
 *  - 候选条目不注入正式分析（status 过滤）
 *  - 沉淀幂等：同一证据重复发现不重复插入
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-candidates-test-${Date.now()}`);

beforeAll(() => {
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  resetKbStoreForTest();
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  resetKbStoreForTest();
  await fs.rm(dir, { recursive: true, force: true });
});

const PET_SAMPLE_INPUT = {
  combat: { durationSec: 500, dungeon: "Grim Batol", level: 12, playerName: "Hunterbeast" },
  aggregate: {
    cooldowns: [] as { t: number; spell?: string; note?: string; actor?: string }[],
    vulnerablePhases: [{ start: 200, end: 230, note: "Phase Transition" }],
    deaths: [] as { t: number; actor?: string }[],
    interrupts: [] as { t: number; spell?: string }[],
    movement: [
      { t: 175, spell: "Dash", actor: "Beast" },
      { t: 179, spell: "Follow", actor: "Beast" },
      { t: 184, spell: "Stay", actor: "Beast" },
    ],
  },
};

describe("疑似高阶技巧判定（T19）", () => {
  it("宠物提前就位样例 → 判疑似，不判失误", () => {
    const suspected = runSuspectedTechniqueDetection(PET_SAMPLE_INPUT, []);
    expect(suspected.some((v) => v.key === "pet-preposition-before-phase")).toBe(true);
    const v = suspected[0];
    expect(v.verdict).toBe("suspected");
    expect(v.explain).toContain("推断");
    expect(v.evidence).toContain("Beast");
  });

  it("知识已解释同一事件时不再判疑似（避免与意图冲突）", () => {
    const explained = [{ atSec: 175 }];
    const suspected = runSuspectedTechniqueDetection(PET_SAMPLE_INPUT, explained);
    expect(suspected.filter((v) => v.key === "pet-preposition-before-phase")).toEqual([]);
  });
});

describe("候选沉淀（T19）", () => {
  it("落库 origin=inferred、status=candidate；正式检索不注入；管理查询可见", async () => {
    const suspected = runSuspectedTechniqueDetection(PET_SAMPLE_INPUT, []);
    const n = await persistSuspectedCandidates(
      { class: "Hunter", spec: "Beast Mastery", dungeon: "Grim Batol" },
      suspected,
    );
    expect(n).toBe(1);

    const store = getKbStore();
    expect(await store.count()).toBe(1);

    // 正式检索（默认 active）查不到候选
    const active = await store.search(
      { text: "宠物 就位 规避 伤害", vector: [] },
      { class: "Hunter", spec: "Beast Mastery", patch: null },
      5,
    );
    expect(active).toEqual([]);

    // 管理查询（显式 candidate）可见
    const candidates = await store.search(
      { text: "宠物 就位 规避 伤害", vector: [] },
      { class: "Hunter", spec: "Beast Mastery", status: "candidate", patch: null },
      5,
    );
    expect(candidates.length).toBe(1);
    expect(candidates[0].meta.origin).toBe("inferred");
    expect(candidates[0].meta.status).toBe("candidate");
  });

  it("沉淀幂等：同一证据重复发现不重复插入", async () => {
    const suspected = runSuspectedTechniqueDetection(PET_SAMPLE_INPUT, []);
    expect(await persistSuspectedCandidates({ class: "Hunter", spec: "Beast Mastery", dungeon: "Grim Batol" }, suspected)).toBe(1);
    expect(await persistSuspectedCandidates({ class: "Hunter", spec: "Beast Mastery", dungeon: "Grim Batol" }, suspected)).toBe(0);
    expect(await getKbStore().count()).toBe(1);
  });

  it("candidateSourceHash 稳定：相同输入恒定", () => {
    const s = runSuspectedTechniqueDetection(PET_SAMPLE_INPUT, []);
    const a = candidateSourceHash({ class: "Hunter", spec: "BM", dungeon: "X" }, s[0]);
    const b = candidateSourceHash({ class: "Hunter", spec: "BM", dungeon: "X" }, s[0]);
    expect(a).toBe(b);
  });
});
