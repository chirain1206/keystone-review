import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  computeSourceHash,
  parseFrontmatter,
  parseKbFile,
  runIngest,
  splitLongSection,
  splitSections,
} from "@/lib/kb/ingest";
import { mockEmbedding, EMBEDDING_DIM } from "@/lib/kb/embedding";
import { resetKbStoreForTest } from "@/lib/kb";

/**
 * T15 验收（FR-11 嵌入与入库管线）：
 *  - 嵌入适配器：mock 模式 1024 维、确定性
 *  - frontmatter 校验（必填字段 + source_url 格式）
 *  - 分节切块 + 节内覆写注释
 *  - 入库幂等：重复执行不重复插入
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-ingest-test-${Date.now()}`);

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

const SAMPLE = `---
class: Mage
spec: Fire
dungeon: "*"
patch: 12.1
type: intent_pattern
source_url: https://bbs.nga.cn/read.php?tid=46306031
---

# 火焰法师打法要点

## 意图模式：聚怪前打资源赌触发

怪聚齐前打资源赌 Hot Streak 触发，聚齐后带着增益第一时间爆发。

<!-- dungeon: Mists of Tirna Scithe -->

## 爆发规划：Combustion 固定循环

Combustion 期间 Fire Blast 与 Pyroblast 交替，Phoenix Flames 补冲能。
`;

describe("嵌入适配器（mock）", () => {
  it("1024 维且同一文本确定性", () => {
    const a = mockEmbedding("火焰法师爆发");
    const b = mockEmbedding("火焰法师爆发");
    expect(a.length).toBe(EMBEDDING_DIM);
    expect(a).toEqual(b);
    expect(mockEmbedding("另一段文本")).not.toEqual(a);
  });

  it("向量已归一化（模长≈1）", () => {
    const v = mockEmbedding("归一化测试");
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-9);
  });
});

describe("kb 源文件解析", () => {
  it("frontmatter 解析 + 必填字段校验", () => {
    const parsed = parseKbFile("mage-fire.md", SAMPLE);
    expect(parsed.meta.class).toBe("Mage");
    expect(parsed.meta.spec).toBe("Fire");
    expect(parsed.meta.patch).toBe("12.1");
    expect(parsed.meta.source_url).toContain("https://");
    expect(parsed.chunks.length).toBe(2);
  });

  it("缺失必填字段时报错并指明文件名", () => {
    const bad = SAMPLE.replace("spec: Fire\n", "");
    expect(() => parseKbFile("bad.md", bad)).toThrow(/bad\.md.*spec/);
  });

  it("source_url 非 http(s) 时报错", () => {
    const bad = SAMPLE.replace("https://bbs.nga.cn/read.php?tid=46306031", "not-a-url");
    expect(() => parseKbFile("bad.md", bad)).toThrow(/http/);
  });

  it("节内覆写注释生效（dungeon 覆写进 chunk meta）", () => {
    const parsed = parseKbFile("mage-fire.md", SAMPLE);
    // 覆写注释位于"意图模式"节内 → 第 1 个 chunk 的 dungeon 被覆写
    expect(parsed.chunks[0].meta.dungeon).toBe("Mists of Tirna Scithe");
    // 第 2 个 chunk 未覆写 → 沿用 frontmatter 的 "*"
    expect(parsed.chunks[1].meta.dungeon).toBe("*");
  });

  it("长节按段落切块且不超过上限", () => {
    const long = Array.from({ length: 60 }, (_, i) => `第 ${i} 段内容：持续输出保持节奏，与队友沟通打断顺序并预铺减伤。`).join("\n\n");
    const chunks = splitLongSection(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1200);
  });

  it("source_hash 幂等：相同文件+内容恒定；内容变更则变化", () => {
    const a = computeSourceHash("f.md", { class: "Mage" }, "内容");
    const b = computeSourceHash("f.md", { class: "Mage" }, "内容");
    expect(a).toBe(b);
    expect(computeSourceHash("f.md", { class: "Mage" }, "内容2")).not.toBe(a);
  });

  it("splitSections / parseFrontmatter 边界：无 frontmatter 视为纯正文", () => {
    const { data, body } = parseFrontmatter("没有 frontmatter 的正文");
    expect(data).toEqual({});
    expect(body).toContain("没有 frontmatter");
    expect(splitSections("## 标题\n正文")).toHaveLength(1);
  });
});

describe("入库管线（幂等）", () => {
  it("runIngest 入库 kb/sources 真实目录：片段 ≥10、重复执行零新增", async () => {
    const sourcesDir = path.join(process.cwd(), "kb", "sources");
    const first = await runIngest(sourcesDir);
    expect(first.errors).toEqual([]);
    expect(first.chunks).toBeGreaterThanOrEqual(10);
    expect(first.upserted).toBeGreaterThanOrEqual(10);

    const second = await runIngest(sourcesDir);
    expect(second.errors).toEqual([]);
    expect(second.upserted).toBe(0); // 内容一致 → 全部幂等跳过
    expect(second.skipped).toBe(second.chunks);
  });

  it("runIngest 校验失败文件会记入 errors 而不中断其他文件", async () => {
    const tmpDir = path.join(dir, "sources");
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, "good.md"), SAMPLE, "utf8");
    await fs.writeFile(path.join(tmpDir, "broken.md"), "# 没有 frontmatter\n正文", "utf8");

    const stats = await runIngest(tmpDir);
    expect(stats.errors.length).toBe(1);
    expect(stats.errors[0]).toContain("broken.md");
    expect(stats.upserted).toBe(2); // good.md 的两个 chunk 正常入库
  });
});
