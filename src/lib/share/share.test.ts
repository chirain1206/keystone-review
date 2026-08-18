import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getRepo, resetRepoForTest } from "@/lib/db";
import {
  createOrGetShare,
  disableShare,
  generateShareToken,
  getPublicShareData,
} from "@/lib/share/service";

/**
 * T11 验收（FR-9）：
 *  - 128-bit 随机 token（32 hex），不可枚举
 *  - 开启/关闭分享；关闭后原链接立即失效
 *  - 公开页只读数据不含账户信息
 *  - 删除 report 后分享失效（级联）
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-share-test-${Date.now()}`);

beforeAll(() => {
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  resetRepoForTest();
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(() => resetRepoForTest());

async function seedReport(userId = "user-a") {
  const repo = getRepo();
  const r = await repo.createReport({
    userId,
    sourceType: "file",
    dungeon: "Grim Batol",
    level: 12,
    spec: "Fire",
    playerName: "Mymage",
    playerClass: "Mage",
    result: true,
  });
  await repo.upsertChapter({
    reportId: r.id,
    chapterNo: 1,
    title: "总体概览",
    content: "本章内容",
    status: "done",
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0,
  });
  const conv = await repo.createConversation(r.id);
  await repo.addMessage({
    conversationId: conv.id,
    reportId: r.id,
    role: "assistant",
    content: "问答内容",
  });
  return r;
}

describe("分享 token", () => {
  it("128-bit 随机：32 位 hex 且互不相同", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateShareToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});

describe("分享生命周期（FR-9）", () => {
  it("开启分享 → 公开页可读 → 关闭后立即失效 → 重开恢复", async () => {
    const r = await seedReport();

    const created = await createOrGetShare("user-a", r.id);
    expect(created.ok).toBe(true);
    expect(created.share!.enabled).toBe(true);

    const pub = await getPublicShareData(created.share!.token);
    expect(pub).not.toBeNull();
    expect(pub!.report.dungeon).toBe("Grim Batol");
    expect(pub!.chapters.length).toBe(1);
    expect(pub!.messages.length).toBe(1);
    // 不含账户信息
    expect(JSON.stringify(pub)).not.toContain("user-a");
    expect(JSON.stringify(pub)).not.toContain("email");

    await disableShare("user-a", r.id);
    expect(await getPublicShareData(created.share!.token)).toBeNull();

    const reopened = await createOrGetShare("user-a", r.id);
    expect(reopened.ok).toBe(true);
    expect(reopened.share!.enabled).toBe(true);
    expect(await getPublicShareData(reopened.share!.token)).not.toBeNull();
  });

  it("属主校验：他人不能开启/关闭我的分享", async () => {
    const r = await seedReport("user-a");
    expect((await createOrGetShare("user-b", r.id)).ok).toBe(false);
    // 先开一个，再验证他人关不掉
    await createOrGetShare("user-a", r.id);
    expect((await disableShare("user-b", r.id)).ok).toBe(false);
    // user-a 的分享仍然有效
    const shares = await getRepo().listShares("user-a", r.id);
    expect(shares[0].enabled).toBe(true);
  });

  it("删除 report 后分享链接失效（级联，FR-8 联动）", async () => {
    const r = await seedReport();
    const { share } = await createOrGetShare("user-a", r.id);
    await getRepo().deleteReport("user-a", r.id);
    expect(await getPublicShareData(share!.token)).toBeNull();
  });
});
