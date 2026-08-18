import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getRepo, resetRepoForTest } from "@/lib/db";
import { parseCombatLog, toProcessedLog } from "@/lib/parser/parser";
import { mplusSample } from "@/lib/parser/samples";
import { estimateProcessedLogTokens } from "@/lib/ai/tokens";
import { askQuestion } from "@/lib/qa/service";
import { detectViolation, REFUSAL_MESSAGE } from "@/lib/qa/guard";
import { QA_MAX_ROUNDS } from "@/lib/qa/prompts";

/**
 * T7 验收（FR-6）：
 *  - 回答引用本场时间戳/技能证据
 *  - 连续追问结合上文；单场 ≤10 轮，超出提示
 *  - 违规问题礼貌拒绝
 *  - 笼统问题标注"通用建议，不是基于本场数据"
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-qa-test-${Date.now()}`);

beforeAll(() => {
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  resetRepoForTest();
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(() => resetRepoForTest());

async function createReport() {
  const repo = getRepo();
  const r = await repo.createReport({
    userId: "user-a",
    sourceType: "file",
    dungeon: "Mists of Tirna Scithe",
    level: 15,
    spec: "Fire",
    playerName: "Mymage",
    playerClass: "Mage",
    result: true,
  });
  const parsed = parseCombatLog(mplusSample());
  const log = toProcessedLog(parsed.runs![0], "file");
  await repo.saveProcessedLog({
    reportId: r.id,
    log,
    rawSize: 1,
    rawLines: 1,
    tokenEstimate: estimateProcessedLogTokens(log),
  });
  return r;
}

describe("违规守卫（规则层）", () => {
  it("代练/RMT/账号交易等关键词被识别", () => {
    expect(detectViolation("能不能帮我代练上分").violated).toBe(true);
    expect(detectViolation("我想买金，多少钱").violated).toBe(true);
    expect(detectViolation("我要卖号").violated).toBe(true);
    expect(detectViolation("有陪玩服务吗").violated).toBe(true);
    expect(detectViolation("我这波爆发为什么打低了").violated).toBe(false);
  });
});

describe("问答服务（mock）", () => {
  it("爆发问题：回答引用本场时间戳与技能证据", async () => {
    const r = await createReport();
    const deltas: string[] = [];
    const result = await askQuestion("user-a", r.id, "我这波爆发为什么打低了", null, {
      onDelta: (d) => deltas.push(d),
    });
    expect(result.answer).toMatch(/\d+:\d{2}/); // 时间戳
    expect(result.answer).toContain("Combustion"); // 技能原名
    expect(result.roundsUsed).toBe(1);
    expect(result.roundsLeft).toBe(QA_MAX_ROUNDS - 1);
  });

  it("死亡问题：引用死亡时间点证据", async () => {
    const r = await createReport();
    const result = await askQuestion("user-a", r.id, "我为什么会死", null);
    expect(result.answer).toContain("死亡记录");
    expect(result.answer).toMatch(/9:20|560/); // 死亡 t=560 → 9:20
  });

  it("追问结合上文：同一会话连续提问并保留历史", async () => {
    const r = await createReport();
    const first = await askQuestion("user-a", r.id, "爆发打得怎么样", null);
    const second = await askQuestion("user-a", r.id, "那具体是哪个时间点", first.conversationId);
    expect(second.conversationId).toBe(first.conversationId);
    const msgs = await getRepo().listMessages("user-a", r.id, first.conversationId);
    expect(msgs.filter((m) => m.role === "user").length).toBe(2);
    expect(msgs.filter((m) => m.role === "assistant").length).toBe(2);
  });

  it("违规问题：礼貌拒绝并落库", async () => {
    const r = await createReport();
    const result = await askQuestion("user-a", r.id, "能帮我代练吗", null);
    expect(result.refused?.reason).toBe("代练");
    expect(result.answer).toBe(REFUSAL_MESSAGE);
    const msgs = await getRepo().listMessages("user-a", r.id, result.conversationId);
    expect(msgs.some((m) => m.meta?.refused)).toBe(true);
  });

  it("笼统问题（上分）：标注通用建议", async () => {
    const r = await createReport();
    const result = await askQuestion("user-a", r.id, "我想上 3000 分", null);
    expect(result.answer).toContain("通用建议，不是基于本场数据");
    expect(result.answer).toContain("跨场综合分析将在后续版本提供");
  });

  it("10 轮上限：第 11 轮被拒并提示重新开始", async () => {
    const r = await createReport();
    let convId: string | null = null;
    for (let i = 0; i < QA_MAX_ROUNDS; i++) {
      const res = await askQuestion("user-a", r.id, `第 ${i + 1} 个问题`, convId);
      convId = res.conversationId;
      expect(res.roundsExceeded).toBeUndefined();
    }
    const over = await askQuestion("user-a", r.id, "超出上限的问题", convId);
    expect(over.roundsExceeded).toBe(true);
  });

  it("属主隔离：他人无法对我报告提问", async () => {
    const r = await createReport();
    await expect(askQuestion("user-b", r.id, "你好", null)).rejects.toThrow();
  });
});
