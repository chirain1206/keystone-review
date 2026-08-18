import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildKbQueryText,
  formatKbContext,
  generateKbDelimiters,
  retrieveKnowledge,
  resolveActivePatch,
} from "@/lib/kb/retrieval";
import { getKbStore, resetKbStoreForTest } from "@/lib/kb";
import type { KbDocument, KbMeta } from "@/lib/kb/types";

/**
 * T16 验收（FR-11 核心链路）：
 *  - 查询构造与嵌入检索（mock）
 *  - 注入格式：定界包裹 + 来源标注 + ≤5 条
 *  - 检索仅 status=active（候选/弃用绝不注入）
 *  - patch 过滤：ACTIVE_PATCH 环境变量 + 缺省最新补丁
 *  - 降级：库空/未命中/检索异常 → null，不报错
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-retrieval-test-${Date.now()}`);

beforeAll(() => {
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  resetKbStoreForTest();
  delete process.env.DATA_DIR;
  delete process.env.ACTIVE_PATCH;
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  resetKbStoreForTest();
  delete process.env.ACTIVE_PATCH;
  await fs.rm(dir, { recursive: true, force: true });
});

function doc(overrides: {
  chunkText: string;
  class: string;
  spec: string;
  dungeon?: string;
  patch?: string;
  type?: string;
  origin?: KbMeta["origin"];
  status?: KbMeta["status"];
}): KbDocument {
  return {
    id: `id-${Math.random().toString(36).slice(2, 8)}`,
    sourceHash: `hash-${Math.random().toString(36).slice(2, 10)}`,
    embedding: new Array(1024).fill(0),
    chunkText: overrides.chunkText,
    meta: {
      class: overrides.class,
      spec: overrides.spec,
      dungeon: overrides.dungeon ?? "*",
      patch: overrides.patch ?? "12.1",
      type: overrides.type ?? "intent_pattern",
      source_url: "https://example.com/kb",
      origin: overrides.origin ?? "curated",
      status: overrides.status ?? "active",
    },
  };
}

async function seed(store = getKbStore()): Promise<void> {
  await store.upsert([
    doc({ chunkText: "火焰法师爆发规划：Combustion 12 秒循环与药水重叠。", class: "Mage", spec: "Fire" }),
    doc({ chunkText: "火焰法师意图模式：聚怪前打资源赌 Hot Streak 触发。", class: "Mage", spec: "Fire" }),
    doc({
      chunkText: "候选技巧：宠物提前就位规避落地伤害（待人工审核）。",
      class: "Hunter",
      spec: "Beast Mastery",
      origin: "inferred",
      status: "candidate",
    }),
    doc({
      chunkText: "跨版本通用：火焰法师资源循环原理。",
      class: "Mage",
      spec: "Fire",
      patch: "general",
    }),
    doc({
      chunkText: "旧补丁 12.0 打法：爆发全交开场（已过时）。",
      class: "Mage",
      spec: "Fire",
      patch: "12.0",
    }),
  ]);
}

describe("查询构造与格式化（T16）", () => {
  it("buildKbQueryText 组合 class/spec/dungeon/章节/问题", () => {
    const t = buildKbQueryText({
      playerClass: "Mage",
      playerSpec: "Fire",
      dungeon: "Mists of Tirna Scithe",
      chapterNo: 5,
    });
    expect(t).toContain("Mage");
    expect(t).toContain("Fire");
    expect(t).toContain("Mists of Tirna Scithe");
    expect(t).toContain("战术意图");
  });

  it("formatKbContext：随机定界包裹 + 来源标注 + ≤5 条", () => {
    const hits = Array.from({ length: 8 }, (_, i) => ({
      id: `id-${i}`,
      chunkText: `知识片段 ${i}`,
      score: 1 - i * 0.1,
      meta: {
        class: "Mage",
        spec: "Fire",
        dungeon: "*",
        patch: "12.1",
        type: "intent_pattern",
        source_url: `https://example.com/kb/${i}`,
        origin: "curated" as const,
        status: "active" as const,
      },
    }));
    const delims = generateKbDelimiters();
    const formatted = formatKbContext(hits, delims);
    expect(formatted.startsWith(delims.start)).toBe(true);
    expect(formatted.endsWith(delims.end)).toBe(true);
    expect(formatted).toContain("参考社区攻略");
    expect(formatted).toContain("https://example.com/kb/0");
    expect(formatted.split("[片段").length - 1).toBe(5); // 最多 5 条
  });
});

describe("检索注入与过滤（T16）", () => {
  it("命中：返回 active 知识且带补丁过滤（12.1 + general）", async () => {
    await seed();
    const kb = await retrieveKnowledge({
      playerClass: "Mage",
      playerSpec: "Fire",
      dungeon: "Mists of Tirna Scithe",
      chapterNo: 5,
    });
    expect(kb).not.toBeNull();
    expect(kb!.hits.length).toBeLessThanOrEqual(5);
    expect(kb!.hits.every((h) => h.meta.status === "active")).toBe(true);
    expect(kb!.hits.every((h) => h.meta.patch === "12.1" || h.meta.patch === "general")).toBe(true);
    expect(kb!.formatted).toContain(kb!.delimiters.start);
  });

  it("候选条目绝不注入（status=candidate 被过滤）", async () => {
    await seed();
    const kb = await retrieveKnowledge({
      playerClass: "Hunter",
      playerSpec: "Beast Mastery",
      dungeon: "Grim Batol",
      question: "宠物提前就位规避落地伤害",
    });
    expect(kb).toBeNull(); // 库里只有候选 → 命中为空 → 降级 null
  });

  it("ACTIVE_PATCH 环境变量优先：设 12.0 时只注入 12.0 + general", async () => {
    process.env.ACTIVE_PATCH = "12.0";
    await seed();
    expect(await resolveActivePatch()).toBe("12.0");
    const kb = await retrieveKnowledge({
      playerClass: "Mage",
      playerSpec: "Fire",
      dungeon: "*",
      chapterNo: 5,
    });
    expect(kb).not.toBeNull();
    expect(kb!.hits.every((h) => h.meta.patch === "12.0" || h.meta.patch === "general")).toBe(true);
  });

  it("未命中/空库 → null（降级不报错）", async () => {
    const kb = await retrieveKnowledge({
      playerClass: "Warrior",
      playerSpec: "Protection",
      dungeon: "Grim Batol",
      chapterNo: 5,
    });
    expect(kb).toBeNull();
  });

  it("检索异常 → 降级 null（不抛错）", async () => {
    vi.resetModules();
    vi.doMock("@/lib/kb", () => ({
      getKbStore: () => ({
        search: () => {
          throw new Error("模拟检索故障");
        },
        getActivePatch: async () => "12.1",
        upsert: async () => 0,
        count: async () => 0,
      }),
      resetKbStoreForTest: () => undefined,
    }));
    try {
      const { retrieveKnowledge: rk } = await import("@/lib/kb/retrieval");
      const kb = await rk({
        playerClass: "Mage",
        playerSpec: "Fire",
        dungeon: "*",
        chapterNo: 5,
      });
      expect(kb).toBeNull();
    } finally {
      vi.doUnmock("@/lib/kb");
    }
  });
});
