import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileKbStore, cmpPatch, tokenize } from "@/lib/kb/file-store";
import type { KbDocument, KbMeta } from "@/lib/kb/types";

/**
 * T14 验收（FR-11 存储与检索）：
 *  - 检索命中 / 空结果 / 按 meta 过滤（class/spec/dungeon/type/patch）
 *  - patch 过滤：活跃补丁 + general 始终可见，旧补丁不注入
 *  - top-k ≤ 5
 *  - 按 source_hash 幂等 upsert
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-kb-test-${Date.now()}`);

beforeAll(() => {
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

type MetaInput = Omit<KbMeta, "origin" | "status"> & {
  origin?: KbMeta["origin"];
  status?: KbMeta["status"];
};

type DocInput = Omit<Partial<KbDocument>, "meta"> & { chunkText: string; meta: MetaInput };

function doc(overrides: DocInput): KbDocument {
  const { meta, ...rest } = overrides;
  return {
    id: `id-${Math.random().toString(36).slice(2, 8)}`,
    sourceHash: `hash-${Math.random().toString(36).slice(2, 10)}`,
    embedding: new Array(1024).fill(0),
    ...rest,
    meta: {
      ...meta,
      origin: meta.origin ?? "curated",
      status: meta.status ?? "active",
    },
  };
}

async function seed(): Promise<FileKbStore> {
  const store = new FileKbStore();
  await store.upsert([
    doc({
      chunkText: "火焰法师爆发规划：Combustion 开启后 12 秒内打满 Phoenix Flames 与 Pyroblast，爆发前先攒 Hot Streak。",
      meta: { class: "Mage", spec: "Fire", dungeon: "*", patch: "12.1", type: "burst_planning", source_url: "https://www.wowhead.com/guide/fire-mage" },
    }),
    doc({
      chunkText: "火焰法师意图模式：怪聚齐前打资源赌 Hot Streak 触发，聚齐后带着双增益第一时间爆发。",
      meta: { class: "Mage", spec: "Fire", dungeon: "*", patch: "12.1", type: "intent_pattern", source_url: "https://bbs.nga.cn/read.php?tid=46306031" },
    }),
    doc({
      chunkText: "Mists of Tirna Scithe 副本机制：Mistcaller 易伤阶段前提前留爆发与药水。",
      meta: { class: "Mage", spec: "Fire", dungeon: "Mists of Tirna Scithe", patch: "12.1", type: "dungeon_mechanic", source_url: "https://www.wowhead.com/guide/mists-of-tirna-scithe" },
    }),
    doc({
      chunkText: "火焰法师资源循环原理（跨版本通用）：Fireball 为主要填充，暴击触发 Hot Streak 即打 Pyroblast。",
      meta: { class: "Mage", spec: "Fire", dungeon: "*", patch: "general", type: "resource_management", source_url: "https://www.icy-veins.com/wow/fire-mage-guide" },
    }),
    doc({
      chunkText: "旧补丁 12.0 的打法：爆发全交在开场（已过时，12.1 改为对齐易伤）。",
      meta: { class: "Mage", spec: "Fire", dungeon: "*", patch: "12.0", type: "burst_planning", source_url: "https://www.icy-veins.com/wow/fire-mage-guide" },
    }),
    doc({
      chunkText: "兽王猎人爆发：Bestial Wrath 与 Call of the Wild 错峰开，覆盖两次杀戮命令窗口。",
      meta: { class: "Hunter", spec: "Beast Mastery", dungeon: "*", patch: "12.1", type: "burst_planning", source_url: "https://www.wowhead.com/guide/beast-mastery-hunter" },
    }),
  ]);
  return store;
}

describe("FileKbStore 检索（T14）", () => {
  it("关键词检索命中且按相关度排序", async () => {
    const store = await seed();
    const hits = await store.search(
      { text: "Mage Fire 爆发 Combustion 规划", vector: [] },
      { class: "Mage", spec: "Fire", patch: "12.1" },
      5,
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].chunkText).toContain("爆发规划");
  });

  it("class/spec 过滤：猎人知识不被法师查询命中", async () => {
    const store = await seed();
    const hits = await store.search(
      { text: "爆发 Bestial Wrath", vector: [] },
      { class: "Mage", spec: "Fire", patch: "12.1" },
      5,
    );
    expect(hits.every((h) => h.meta.class === "Mage")).toBe(true);
  });

  it("dungeon 过滤：'*' 通用条目与指定副本条目都命中，其他副本不命中", async () => {
    const store = await seed();
    const hits = await store.search(
      { text: "Mists of Tirna Scithe 机制 爆发", vector: [] },
      { class: "Mage", spec: "Fire", dungeon: "Mists of Tirna Scithe", patch: "12.1" },
      5,
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.every((h) => h.meta.dungeon === "*" || h.meta.dungeon === "Mists of Tirna Scithe")).toBe(true);
  });

  it("spec 过滤：'*' 通用条目命中任意专精，指定专精条目只命中自身", async () => {
    const store = new FileKbStore();
    await store.upsert([
      doc({
        chunkText: "法师资源循环原理（全专精通用）。",
        meta: { class: "Mage", spec: "*", dungeon: "*", patch: "12.1", type: "resource_management", source_url: "https://example.com/kb" },
      }),
      doc({
        chunkText: "火焰法师爆发规划。",
        meta: { class: "Mage", spec: "Fire", dungeon: "*", patch: "12.1", type: "burst_planning", source_url: "https://example.com/kb" },
      }),
    ]);

    // 查询 Fire：命中 Fire 专属 + '*' 通用
    const fire = await store.search(
      { text: "资源 爆发 循环", vector: [] },
      { class: "Mage", spec: "Fire", patch: "12.1" },
      5,
    );
    expect(fire.some((h) => h.meta.spec === "*")).toBe(true);
    expect(fire.every((h) => h.meta.spec === "Fire" || h.meta.spec === "*")).toBe(true);

    // 查询 Arcane：只命中 '*' 通用（Arcane 无专属条目）
    const arcane = await store.search(
      { text: "资源 循环 原理", vector: [] },
      { class: "Mage", spec: "Arcane", patch: "12.1" },
      5,
    );
    expect(arcane.length).toBeGreaterThan(0);
    expect(arcane.every((h) => h.meta.spec === "*")).toBe(true);
  });

  it("patch 过滤：活跃补丁 12.1 只返回 12.1 + general，旧补丁 12.0 不注入", async () => {
    const store = await seed();
    const hits = await store.search(
      { text: "爆发规划 打法", vector: [] },
      { class: "Mage", spec: "Fire", patch: "12.1" },
      5,
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.meta.patch === "12.1" || h.meta.patch === "general")).toBe(true);
    expect(hits.some((h) => h.meta.patch === "12.0")).toBe(false);
  });

  it("不指定 patch 时不过滤（测试口径）", async () => {
    const store = await seed();
    const hits = await store.search(
      { text: "打法", vector: [] },
      { class: "Mage", spec: "Fire" },
      10,
    );
    expect(hits.some((h) => h.meta.patch === "12.0")).toBe(true);
  });

  it("空结果：不匹配任何关键词时返回空数组", async () => {
    const store = await seed();
    const hits = await store.search(
      { text: "完全无关的内容 xyzzy", vector: [] },
      { class: "Mage", spec: "Fire", patch: "12.1" },
      5,
    );
    expect(hits).toEqual([]);
  });

  it("top-k 上限 5：请求 20 也只返回 ≤5", async () => {
    const store = new FileKbStore();
    const many = Array.from({ length: 20 }, (_, i) =>
      doc({
        chunkText: `火焰法师技巧第 ${i} 条：爆发与药水对齐易伤窗口。`,
        meta: { class: "Mage", spec: "Fire", dungeon: "*", patch: "12.1", type: "intent_pattern", source_url: "https://example.com/kb" },
      }),
    );
    await store.upsert(many);
    const hits = await store.search(
      { text: "火焰法师 爆发 药水", vector: [] },
      { class: "Mage", spec: "Fire", patch: "12.1" },
      20,
    );
    expect(hits.length).toBeLessThanOrEqual(5);
  });

  it("getActivePatch：返回库中最新非 general 补丁", async () => {
    const store = await seed();
    expect(await store.getActivePatch()).toBe("12.1");
  });

  it("status 过滤：默认只注入 active，候选/弃用条目绝不注入；显式过滤可查询候选", async () => {
    const store = await seed();
    await store.upsert([
      doc({
        chunkText: "候选技巧：转阶段前宠物提前就位规避落地伤害。",
        meta: { class: "Mage", spec: "Fire", dungeon: "*", patch: "12.1", type: "intent_pattern", source_url: "internal:inference", origin: "inferred", status: "candidate" },
      }),
      doc({
        chunkText: "弃用打法：开场无脑喝药水（已过时）。",
        meta: { class: "Mage", spec: "Fire", dungeon: "*", patch: "12.0", type: "intent_pattern", source_url: "https://www.icy-veins.com/wow/fire-mage-guide", origin: "curated", status: "deprecated" },
      }),
    ]);

    const active = await store.search(
      { text: "宠物 技巧 药水", vector: [] },
      { class: "Mage", spec: "Fire", patch: "12.1" },
      10,
    );
    expect(active.every((h) => h.meta.status === "active")).toBe(true);

    const candidates = await store.search(
      { text: "宠物 技巧", vector: [] },
      { class: "Mage", spec: "Fire", status: "candidate" },
      10,
    );
    expect(candidates.some((h) => h.meta.origin === "inferred" && h.meta.status === "candidate")).toBe(true);
    expect(candidates.every((h) => h.meta.status === "candidate")).toBe(true);
  });

  it("upsert 幂等：相同 source_hash 不重复插入；内容变更则更新", async () => {
    const store = new FileKbStore();
    const d = doc({
      chunkText: "内容 v1",
      meta: { class: "Mage", spec: "Fire", dungeon: "*", patch: "12.1", type: "intent_pattern", source_url: "https://example.com/kb" },
    });
    expect(await store.upsert([d])).toBe(1);
    expect(await store.upsert([d])).toBe(0); // 完全一致 → 跳过
    expect(await store.count()).toBe(1);
    const changed = { ...d, chunkText: "内容 v2" };
    expect(await store.upsert([changed])).toBe(1); // 变更 → 更新
    expect(await store.count()).toBe(1);
  });

  it("tokenize：中文双字词 + 英文词", () => {
    const t = tokenize("火焰法师 Combustion 爆发");
    expect(t.has("火焰")).toBe(true);
    expect(t.has("焰法")).toBe(true);
    expect(t.has("combustion")).toBe(true);
  });

  it("cmpPatch：数值逐段比较（12.10 > 12.2）", () => {
    expect(cmpPatch("12.10", "12.2")).toBeGreaterThan(0);
    expect(cmpPatch("12.1", "12.1")).toBe(0);
    expect(cmpPatch("12.0", "12.1")).toBeLessThan(0);
  });
});
