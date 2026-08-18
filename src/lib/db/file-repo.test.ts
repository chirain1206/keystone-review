import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileRepo } from "@/lib/db/file-repo";
import { resetRepoForTest } from "@/lib/db/index";

/**
 * T2 验收：数据层隔离与级联语义（mock 实现上验证与 RLS 等价的行为）。
 * SQL 迁移的 RLS 策略见 supabase/migrations/0001_init.sql（部署阶段在
 * Supabase 上执行验证；文件存储实现保持相同语义）。
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-test-${Date.now()}`);

beforeAll(() => {
  process.env.DATA_DIR = dir;
});

afterAll(async () => {
  resetRepoForTest();
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("FileRepo 数据隔离与级联（T2）", () => {
  it("用户 A 无法读取用户 B 的 report / chapter / messages", async () => {
    const repo = new FileRepo();
    const a = await repo.createReport({
      userId: "user-a",
      sourceType: "file",
      dungeon: "Mists of Tirna Scithe",
      level: 15,
      spec: "Fire",
      playerName: "MageA",
      playerClass: "Mage",
      result: true,
    });
    await repo.upsertChapter({
      reportId: a.id,
      chapterNo: 1,
      title: "总体概览",
      content: "A 的内容",
      status: "done",
      tokensIn: 100,
      tokensOut: 200,
      costUsd: 0.001,
    });
    const conv = await repo.createConversation(a.id);
    await repo.addMessage({
      conversationId: conv.id,
      reportId: a.id,
      role: "assistant",
      content: "A 的回答",
    });

    // 用户 B 全部拿不到
    expect(await repo.getReport("user-b", a.id)).toBeNull();
    expect(await repo.getChapters("user-b", a.id)).toEqual([]);
    expect(await repo.getChapter("user-b", a.id, 1)).toBeNull();
    expect(await repo.listMessages("user-b", a.id)).toEqual([]);
    expect(await repo.getConversation("user-b", conv.id)).toBeNull();
    expect(await repo.getProcessedLog("user-b", a.id)).toBeNull();
    expect(await repo.listShares("user-b", a.id)).toEqual([]);
    expect(await repo.deleteReport("user-b", a.id)).toBe(false);
    expect(await repo.listReportsByUser("user-b")).toEqual([]);

    // 属主自己拿得到
    expect(await repo.getReport("user-a", a.id)).not.toBeNull();
    expect((await repo.getChapters("user-a", a.id)).length).toBe(1);
  });

  it("删除 report 级联删除章节/问答/分享/结构化数据", async () => {
    const repo = new FileRepo();
    const r = await repo.createReport({
      userId: "user-a",
      sourceType: "link",
      dungeon: "Grim Batol",
      level: 12,
      spec: "Protection",
      playerName: "PalA",
      playerClass: "Paladin",
      result: false,
    });
    await repo.saveProcessedLog({
      reportId: r.id,
      log: {
        version: 1,
        source: "file",
        combat: {
          dungeon: "Grim Batol",
          level: 12,
          startTime: 1,
          endTime: 2,
          durationSec: 1,
          success: false,
          players: [],
          playerName: "PalA",
          playerClass: "Paladin",
          playerSpec: "Protection",
        },
        timeline: [],
        aggregate: {
          interrupts: [],
          deaths: [],
          cooldowns: [],
          vulnerablePhases: [],
          movement: [],
          perMinute: [],
        },
      },
      rawSize: 1000,
      rawLines: 100,
      tokenEstimate: 500,
    });
    const conv = await repo.createConversation(r.id);
    await repo.addMessage({
      conversationId: conv.id,
      reportId: r.id,
      role: "user",
      content: "问题",
    });
    await repo.createShare({ reportId: r.id, token: "a".repeat(32), enabled: true, expiresAt: null });

    expect(await repo.deleteReport("user-a", r.id)).toBe(true);

    // 全部级联清空（含按 id 的内部读取）
    expect(await repo.getReportById(r.id)).toBeNull();
    expect(await repo.getProcessedLogByReportId(r.id)).toBeNull();
    expect(await repo.getChaptersByReportId(r.id)).toEqual([]);
    expect(await repo.listMessagesByReportId(r.id)).toEqual([]);
    expect(await repo.getShareByToken("a".repeat(32))).toBeNull();
  });

  it("章节 upsert 幂等：同一 report+chapter_no 不产生重复行", async () => {
    const repo = new FileRepo();
    const r = await repo.createReport({
      userId: "user-a",
      sourceType: "file",
      dungeon: "The Stonevault",
      level: 8,
      spec: "Restoration",
      playerName: "DruidA",
      playerClass: "Druid",
      result: true,
    });
    const c1 = await repo.upsertChapter({
      reportId: r.id,
      chapterNo: 2,
      title: "关键时机分析",
      content: "第一版",
      status: "done",
      tokensIn: 10,
      tokensOut: 20,
      costUsd: 0.0001,
    });
    const c2 = await repo.upsertChapter({
      reportId: r.id,
      chapterNo: 2,
      title: "关键时机分析",
      content: "重试版",
      status: "done",
      tokensIn: 10,
      tokensOut: 21,
      costUsd: 0.0001,
    });
    expect(c1.id).toBe(c2.id);
    expect(c2.content).toBe("重试版");
    expect((await repo.getChaptersByReportId(r.id)).length).toBe(1);
  });

  it("profile 按 id 读写且不会串用户", async () => {
    const repo = new FileRepo();
    await repo.upsertProfile({ id: "u1", email: "a@x.com", timezone: "Asia/Shanghai" });
    await repo.upsertProfile({ id: "u2", email: "b@x.com", timezone: "UTC" });
    const p1 = await repo.getProfile("u1");
    expect(p1?.email).toBe("a@x.com");
    expect(p1?.timezone).toBe("Asia/Shanghai");
    expect((await repo.getProfile("u2"))?.email).toBe("b@x.com");
  });
});

describe("每日额度原子计数（M-3）", () => {
  it("并发 10 次 increment 结果 1..10 无重复（单进程原子）", async () => {
    const repo = new FileRepo();
    const day = "2026-08-19";
    const results = await Promise.all(
      Array.from({ length: 10 }, () => repo.incrementDailyUsage("user-concurrent", day)),
    );
    results.sort((a, b) => a - b);
    expect(results).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
