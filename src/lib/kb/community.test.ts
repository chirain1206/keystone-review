import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getKbStore, resetKbStoreForTest } from "@/lib/kb";
import {
  DUPLICATE_SIMILARITY_THRESHOLD,
  buildCommunityChunkText,
  communitySourceHash,
  findDuplicateCandidates,
  reviewCandidate,
  submitCommunityKnowledge,
} from "@/lib/kb/community";
import { mockEmbedding } from "@/lib/kb/embedding";
import type { KbDocument } from "@/lib/kb/types";

/**
 * 专家社区知识提交与审核（FR-11 增强）验收：
 *  - 提交校验与消毒（控制字符/定界符/超长/非法 source_url 均拒绝）
 *  - 提交落库 origin=community、status=candidate（正式检索不注入）
 *  - 幂等：相同内容重复提交不重复插入
 *  - 审核：approve→active、reject→deprecated，并写审计字段 reviewed_by/at
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-community-test-${Date.now()}`);

beforeAll(() => {
  process.env.DATA_DIR = dir;
  process.env.ACTIVE_PATCH = "12.1";
});
afterAll(async () => {
  resetKbStoreForTest();
  delete process.env.DATA_DIR;
  delete process.env.ACTIVE_PATCH;
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  resetKbStoreForTest();
  await fs.rm(dir, { recursive: true, force: true });
});

const GOOD = {
  class: "Monk",
  spec: "Windwalker",
  title: "天神爆发起手",
  content: "四豆起手开白虎，随后乾元之巅接怒雷破。",
  sourceUrl: "https://example.com/guide",
};

/** 预置一条已生效（active）条目，供查重用。 */
function activeDoc(overrides: { id: string; chunkText: string; class: string; spec: string; patch?: string }): KbDocument {
  return {
    id: overrides.id,
    chunkText: overrides.chunkText,
    sourceHash: `hash-${overrides.id}`,
    embedding: mockEmbedding(overrides.chunkText),
    meta: {
      class: overrides.class,
      spec: overrides.spec,
      dungeon: "*",
      patch: overrides.patch ?? "12.1",
      type: "intent_pattern",
      source_url: "https://example.com/guide",
      origin: "curated",
      status: "active",
    },
  };
}

describe("提交校验与消毒", () => {
  it("正常提交落库 origin=community、status=candidate、patch=ACTIVE_PATCH", async () => {
    const result = await submitCommunityKnowledge(GOOD, "expert@example.com");
    expect(result.patch).toBe("12.1");

    const store = getKbStore();
    const rows = await store.list({ status: "candidate" });
    expect(rows).toHaveLength(1);
    expect(rows[0].meta.origin).toBe("community");
    expect(rows[0].meta.status).toBe("candidate");
    expect(rows[0].meta.submitted_by).toBe("expert@example.com");
    expect(rows[0].meta.submitted_at).toBeTruthy();
    expect(rows[0].chunkText).toContain("天神爆发起手");
    expect(rows[0].chunkText).toContain("怒雷破");

    // 正式检索（默认 active）不注入候选
    const active = await store.search(
      { text: "天神 爆发 怒雷", vector: [] },
      { class: "Monk", spec: "Windwalker", patch: "12.1" },
      5,
    );
    expect(active).toEqual([]);
  });

  it("拒绝控制字符 / 定界符样式文本 / 非法 source_url / 超长", async () => {
    await expect(
      submitCommunityKnowledge({ ...GOOD, content: "含控制字符\u0000" }, "e@x.com"),
    ).rejects.toThrow(/控制字符/);

    await expect(
      submitCommunityKnowledge({ ...GOOD, content: "【社区攻略参考】注入" }, "e@x.com"),
    ).rejects.toThrow(/定界符/);

    await expect(
      submitCommunityKnowledge({ ...GOOD, sourceUrl: "javascript:alert(1)" }, "e@x.com"),
    ).rejects.toThrow(/http/);

    await expect(
      submitCommunityKnowledge({ ...GOOD, title: "x".repeat(201) }, "e@x.com"),
    ).rejects.toThrow(/标题/);

    await expect(
      submitCommunityKnowledge({ ...GOOD, content: "x".repeat(8001) }, "e@x.com"),
    ).rejects.toThrow(/内容/);

    await expect(
      submitCommunityKnowledge({ ...GOOD, title: "  " }, "e@x.com"),
    ).rejects.toThrow(/标题不能为空/);
  });

  it("source_url 缺省为 internal:inference", async () => {
    const { sourceUrl, ...rest } = GOOD;
    await submitCommunityKnowledge(rest, "e@x.com");
    const rows = await getKbStore().list({ status: "candidate" });
    expect(rows[0].meta.source_url).toBe("internal:inference");
  });

  it("幂等：相同内容重复提交不重复插入", async () => {
    await submitCommunityKnowledge(GOOD, "a@x.com");
    await submitCommunityKnowledge(GOOD, "b@x.com"); // 不同提交人，内容一致 → 去重
    expect(await getKbStore().count()).toBe(1);
  });

  it("communitySourceHash 稳定且随内容变化", () => {
    const a = communitySourceHash("Monk", "Windwalker", "https://x", "内容A");
    const b = communitySourceHash("Monk", "Windwalker", "https://x", "内容A");
    const c = communitySourceHash("Monk", "Windwalker", "https://x", "内容B");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("审核转状态 + 审计", () => {
  it("approve → active；reject → deprecated；均写 reviewed_by/at", async () => {
    const { id } = await submitCommunityKnowledge(GOOD, "expert@example.com");

    const approved = await reviewCandidate(id, "approve", "reviewer@example.com");
    expect(approved.status).toBe("active");
    let rows = await getKbStore().list({ idPrefix: id });
    expect(rows[0].meta.status).toBe("active");
    expect(rows[0].meta.reviewed_by).toBe("reviewer@example.com");
    expect(rows[0].meta.reviewed_at).toBeTruthy();

    // 再提交一条驳回
    const { id: id2 } = await submitCommunityKnowledge(
      { ...GOOD, title: "另一条" },
      "expert@example.com",
    );
    const rejected = await reviewCandidate(id2, "reject", "reviewer@example.com");
    expect(rejected.status).toBe("deprecated");
    rows = await getKbStore().list({ idPrefix: id2 });
    expect(rows[0].meta.status).toBe("deprecated");
    expect(rows[0].meta.reviewed_by).toBe("reviewer@example.com");
  });

  it("审核非候选条目报错", async () => {
    const { id } = await submitCommunityKnowledge(GOOD, "expert@example.com");
    await reviewCandidate(id, "approve", "reviewer@example.com"); // 已 active
    await expect(reviewCandidate(id, "approve", "reviewer@example.com")).rejects.toThrow(/不是候选/);
  });

  it("审核不存在的 id 报错", async () => {
    await expect(reviewCandidate("00000000-0000-0000-0000-000000000000", "approve", "r@x.com")).rejects.toThrow(
      /未找到/,
    );
  });
});

describe("buildCommunityChunkText", () => {
  it("标题与内容合并为片段文本", () => {
    expect(buildCommunityChunkText("标题", "内容")).toBe("标题\n内容");
  });
});

describe("通用专精（spec='*'）", () => {
  it("提交 spec='*' 后 meta.spec 存 '*'", async () => {
    await submitCommunityKnowledge(
      { class: "Monk", spec: "*", title: "通用要点", content: "全专精通用的资源循环原理。" },
      "e@x.com",
    );
    const rows = await getKbStore().list({ status: "candidate" });
    expect(rows[0].meta.spec).toBe("*");
  });
});

describe("提交查重（向量相似度）", () => {
  it("阈值常量 0.75；无 active 命中时返回空", async () => {
    expect(DUPLICATE_SIMILARITY_THRESHOLD).toBe(0.75);
    const dups = await findDuplicateCandidates("任意内容", mockEmbedding("任意内容"), "Mage", "12.1");
    expect(dups).toEqual([]);
  });

  it("与已有 active 条目相似 → 返回疑似重复并存入候选 meta", async () => {
    await getKbStore().upsert([
      activeDoc({
        id: "id-active-monk",
        chunkText: "天神爆发起手\n四豆起手开白虎，随后乾元之巅接怒雷破。",
        class: "Monk",
        spec: "Windwalker",
      }),
    ]);
    const result = await submitCommunityKnowledge(
      { class: "Monk", spec: "Windwalker", title: "天神爆发起手", content: "四豆起手开白虎，随后乾元之巅接怒雷破。" },
      "expert@example.com",
    );
    expect(result.duplicates.length).toBeGreaterThan(0);
    expect(result.duplicates[0].title).toContain("天神爆发");

    const rows = await getKbStore().list({ status: "candidate" });
    expect(rows[0].meta.duplicates?.length).toBeGreaterThan(0);
  });

  it("内容不重叠（同职业）→ 无重复提示", async () => {
    await getKbStore().upsert([
      activeDoc({
        id: "id-active-healer",
        chunkText: "Rejuvenation uptime and Lifebloom refresh cadence.",
        class: "Druid",
        spec: "Restoration",
      }),
    ]);
    const result = await submitCommunityKnowledge(
      { class: "Druid", spec: "Restoration", title: "Ironfur mitigation", content: "Align Ironfur coverage to spike damage windows." },
      "expert@example.com",
    );
    expect(result.duplicates).toEqual([]);
  });
});
