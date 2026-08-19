import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileKbStore } from "@/lib/kb/file-store";
import type { KbDocument, KbMeta } from "@/lib/kb/types";
import { parseManageArgs, resolveByPrefix, runManage } from "@/lib/kb/manage";
import type { CommandIO } from "@/lib/kb/manage";

/**
 * T20 验收（知识库运维管理 CLI）：
 *  - store 新增方法：list 过滤 / updateStatus 下线激活 / deleteByIds 物理删除
 *  - 参数解析（值旗标 / 布尔 --yes / --flag=value / 位置参数）
 *  - 子命令行为：list 过滤、deprecate（前缀唯一/已下线/批量）、reactivate、delete dry-run 与 --yes、stats
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-kb-manage-test-${Date.now()}`);

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

function doc(id: string, chunkText: string, meta: MetaInput): KbDocument {
  return {
    id,
    chunkText,
    sourceHash: `hash-${id}`,
    embedding: new Array(1024).fill(0),
    meta: { ...meta, origin: meta.origin ?? "curated", status: meta.status ?? "active" } as KbMeta,
  };
}

const ID_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ID_A2 = "aaaaaaaa-0000-0000-0000-000000000002";
const ID_B = "bbbbbbbb-0000-0000-0000-000000000001";
const ID_C = "cccccccc-0000-0000-0000-000000000001";

async function seed(): Promise<FileKbStore> {
  const store = new FileKbStore();
  await store.upsert([
    doc(ID_A, "火焰法师 12.1 爆发规划：Combustion 期间对齐易伤窗口。", { class: "Mage", spec: "Fire", dungeon: "*", patch: "12.1", type: "burst_planning", source_url: "https://wowhead.com/a", origin: "curated", status: "active" }),
    doc(ID_A2, "火焰法师 12.1 意图模式：聚怪前攒 Hot Streak。", { class: "Mage", spec: "Fire", dungeon: "*", patch: "12.1", type: "intent_pattern", source_url: "https://wowhead.com/a2", origin: "curated", status: "active" }),
    doc(ID_B, "兽王猎人 12.0 爆发（过时打法）。", { class: "Hunter", spec: "Beast Mastery", dungeon: "*", patch: "12.0", type: "burst_planning", source_url: "https://wowhead.com/b", origin: "inferred", status: "candidate" }),
    doc(ID_C, "旧补丁 12.0 已弃用打法。", { class: "Mage", spec: "Fire", dungeon: "*", patch: "12.0", type: "intent_pattern", source_url: "https://wowhead.com/c", origin: "curated", status: "deprecated" }),
  ]);
  return store;
}

function capture(): { io: CommandIO; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    io: { log: (s) => lines.push(s), error: (s) => lines.push(s) },
  };
}

describe("参数解析（T20）", () => {
  it("解析子命令 + 值旗标 + 位置参数", () => {
    const a = parseManageArgs(["list", "--patch", "12.1", "--status", "active", "--limit", "20"]);
    expect(a.cmd).toBe("list");
    expect(a.flags["--patch"]).toBe("12.1");
    expect(a.flags["--status"]).toBe("active");
    expect(a.flags["--limit"]).toBe("20");
    expect(a.positionals).toEqual([]);
  });

  it("解析 --flag=value 与布尔 --yes", () => {
    const a = parseManageArgs(["delete", "--patch=12.0", "--yes"]);
    expect(a.cmd).toBe("delete");
    expect(a.flags["--patch"]).toBe("12.0");
    expect(a.flags["--yes"]).toBe(true);
  });

  it("解析位置 id 前缀与 --reason 备注", () => {
    const a = parseManageArgs(["deprecate", "aaaaaaaa", "--reason", "过时"]);
    expect(a.cmd).toBe("deprecate");
    expect(a.positionals).toEqual(["aaaaaaaa"]);
    expect(a.flags["--reason"]).toBe("过时");
  });
});

describe("store 新增方法（list / updateStatus / deleteByIds）", () => {
  it("list：按 patch/status/origin/class 组合过滤 + limit 截断", async () => {
    const store = await seed();
    expect((await store.list({ patch: "12.0" })).length).toBe(2);
    expect((await store.list({ status: "deprecated" })).map((r) => r.id)).toEqual([ID_C]);
    expect((await store.list({ origin: "inferred" })).map((r) => r.id)).toEqual([ID_B]);
    expect((await store.list({ class: "Hunter" })).map((r) => r.id)).toEqual([ID_B]);
    expect((await store.list({ patch: "12.1" })).length).toBe(2);
    expect((await store.list({})).length).toBe(4);
    expect((await store.list({ limit: 1 })).length).toBe(1);
  });

  it("list：idPrefix 匹配（大小写不敏感）", async () => {
    const store = await seed();
    expect((await store.list({ idPrefix: "cccccccc" })).map((r) => r.id)).toEqual([ID_C]);
    expect((await store.list({ idPrefix: "AAAAAAAA" })).length).toBe(2); // 歧义的两条
  });

  it("updateStatus：下线与激活，返回实际变更条数", async () => {
    const store = await seed();
    expect(await store.updateStatus([ID_A], "deprecated")).toBe(1);
    expect((await store.list({ idPrefix: "aaaaaaaa-0000-0000-0000-000000000001" }))[0].meta.status).toBe("deprecated");
    // 已是目标状态 → 0
    expect(await store.updateStatus([ID_A], "deprecated")).toBe(0);
    expect(await store.updateStatus([ID_A], "active")).toBe(1);
    expect((await store.list({ idPrefix: "aaaaaaaa-0000-0000-0000-000000000001" }))[0].meta.status).toBe("active");
  });

  it("deleteByIds：物理删除并返回删除条数", async () => {
    const store = await seed();
    expect(await store.deleteByIds([ID_A, ID_C])).toBe(2);
    expect(await store.count()).toBe(2);
    expect(await store.deleteByIds([ID_A])).toBe(0); // 已删除 → 0
  });

  it("resolveByPrefix：唯一命中 / 歧义报错 / 未命中报错", async () => {
    const store = await seed();
    expect((await resolveByPrefix(store, "bbbbbbbb")).id).toBe(ID_B);
    await expect(resolveByPrefix(store, "aaaaaaaa")).rejects.toThrow(/不唯一/);
    await expect(resolveByPrefix(store, "zzzzzzzz")).rejects.toThrow(/未找到/);
  });
});

describe("runManage 子命令（T20）", () => {
  it("list：中文输出包含 id/status/class 与过滤", async () => {
    const store = await seed();
    const { io, lines } = capture();
    expect(await runManage(store, parseManageArgs(["list", "--status", "active"]), io)).toBe(0);
    expect(lines.join("\n")).toContain("共 2 条片段");
    expect(lines.join("\n")).toContain("Mage/Fire");
    expect(lines.join("\n")).not.toContain("deprecated");
  });

  it("deprecate 前缀唯一：active → deprecated，再次执行报已下线", async () => {
    const store = await seed();
    const { io, lines } = capture();
    expect(await runManage(store, parseManageArgs(["deprecate", "bbbbbbbb", "--reason", "测试下线"]), io)).toBe(0);
    expect((await store.list({ idPrefix: "bbbbbbbb" }))[0].meta.status).toBe("deprecated");
    expect(lines.join("\n")).toContain("已下线 1 条");

    const again = capture();
    expect(await runManage(store, parseManageArgs(["deprecate", "bbbbbbbb"]), again.io)).toBe(0);
    expect(again.lines.join("\n")).toContain("已下线");
  });

  it("deprecate 前缀歧义：报错退出码 1 且不改动", async () => {
    const store = await seed();
    const { io, lines } = capture();
    expect(await runManage(store, parseManageArgs(["deprecate", "aaaaaaaa"]), io)).toBe(1);
    expect(lines.join("\n")).toContain("不唯一");
    expect((await store.list({ idPrefix: "aaaaaaaa" })).every((r) => r.meta.status === "active")).toBe(true);
  });

  it("deprecate --all-patch：批量下线整补丁", async () => {
    const store = await seed();
    const { io, lines } = capture();
    expect(await runManage(store, parseManageArgs(["deprecate", "--all-patch", "12.0"]), io)).toBe(0);
    const p120 = await store.list({ patch: "12.0" });
    expect(p120.every((r) => r.meta.status === "deprecated")).toBe(true);
    expect(lines.join("\n")).toContain("已下线");
  });

  it("reactivate：deprecated → active；active 无需激活", async () => {
    const store = await seed();
    const { io, lines } = capture();
    expect(await runManage(store, parseManageArgs(["reactivate", "cccccccc"]), io)).toBe(0);
    expect((await store.list({ idPrefix: "cccccccc" }))[0].meta.status).toBe("active");
    expect(lines.join("\n")).toContain("已激活 1 条");

    const again = capture();
    expect(await runManage(store, parseManageArgs(["reactivate", "cccccccc"]), again.io)).toBe(0);
    expect(again.lines.join("\n")).toContain("本已是 active");
  });

  it("delete 默认 dry-run：打印条数不删除；--yes 才真删", async () => {
    const store = await seed();
    const dry = capture();
    expect(await runManage(store, parseManageArgs(["delete", "--patch", "12.0"]), dry.io)).toBe(0);
    expect(dry.lines.join("\n")).toContain("将删除 2 条");
    expect(dry.lines.join("\n")).toContain("dry-run");
    expect(await store.count()).toBe(4); // 未删

    const yes = capture();
    expect(await runManage(store, parseManageArgs(["delete", "--patch", "12.0", "--yes"]), yes.io)).toBe(0);
    expect(yes.lines.join("\n")).toContain("已物理删除 2 条");
    expect(await store.count()).toBe(2);
  });

  it("delete --status deprecated --yes：按状态批量删除", async () => {
    const store = await seed();
    const { io, lines } = capture();
    expect(await runManage(store, parseManageArgs(["delete", "--status", "deprecated", "--yes"]), io)).toBe(0);
    expect(lines.join("\n")).toContain("已物理删除 1 条");
    expect(await store.count()).toBe(3);
  });

  it("delete 前缀唯一 + --yes：按 id 前缀删除", async () => {
    const store = await seed();
    const { io, lines } = capture();
    expect(await runManage(store, parseManageArgs(["delete", "cccccccc", "--yes"]), io)).toBe(0);
    expect(lines.join("\n")).toContain("已物理删除 1 条");
    expect((await store.list({ idPrefix: "cccccccc" }))).toEqual([]);
  });

  it("stats：按 patch/status/origin 输出统计", async () => {
    const store = await seed();
    const { io, lines } = capture();
    expect(await runManage(store, parseManageArgs(["stats"]), io)).toBe(0);
    const out = lines.join("\n");
    expect(out).toContain("库内片段总数：4");
    expect(out).toContain("按补丁");
    expect(out).toContain("12.1  2");
    expect(out).toContain("12.0  2");
    expect(out).toContain("按状态");
    expect(out).toContain("active  2");
    expect(out).toContain("candidate  1");
    expect(out).toContain("deprecated  1");
    expect(out).toContain("按来源");
  });

  it("未知子命令：打印用法并退出码 2", async () => {
    const store = await seed();
    const { io, lines } = capture();
    expect(await runManage(store, parseManageArgs(["nope"]), io)).toBe(2);
    expect(lines.join("\n")).toContain("未知子命令");
  });

  it("非法 status 过滤：退出码 1", async () => {
    const store = await seed();
    const { io, lines } = capture();
    expect(await runManage(store, parseManageArgs(["list", "--status", "bogus"]), io)).toBe(1);
    expect(lines.join("\n")).toContain("非法 status");
  });
});
