import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildSearchQuery,
  countItems,
  formatExistingKnowledge,
  runVideoToKb,
  sanitizeBody,
  type VideoKbDeps,
  type VideoKbInput,
} from "@/lib/video/pipeline";
import { buildExtractionPrompt, renderGlossary } from "@/lib/video/extract";
import { normalizeTerms } from "@/lib/kb/term-dict";
import type { KbHit } from "@/lib/kb/types";

/**
 * video-to-kb 管线验收：mock asr/yt-dlp/DeepSeek/检索 注入点，
 * 覆盖：字幕/ASR 两分支、术语纠错、检索查询构造、提示词构造、落盘 frontmatter。
 * 真实 API 不测（少量、克制）。
 */

const dir = path.join(os.tmpdir(), `wow-analyzer-video-test-${Date.now()}`);

beforeAll(() => {
  process.env.DATA_DIR = path.join(dir, "data");
});
afterAll(async () => {
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
});

function input(over: Partial<VideoKbInput> = {}): VideoKbInput {
  return {
    url: "https://www.bilibili.com/video/BV1TEST/",
    class: "Monk",
    spec: "Windwalker",
    patch: "12.1",
    up: "测试UP",
    sourcesDir: path.join(dir, "kb", "sources"),
    workDir: path.join(dir, "video-work"),
    ...over,
  };
}

function makeDeps(over: Partial<VideoKbDeps> = {}) {
  const downloadAudio = vi.fn(async (_url: string, _opts: { browser?: string; workDir: string }) =>
    path.join(dir, "video-work", "audio", "audio.m4a"),
  );
  const transcribe = vi.fn(async (_audioPath: string) => "转写正文：怒雷与集分梯的手法");
  const extractKnowledge = vi.fn(
    async (_p: { system: string; user: string }) => "# 标题\n\n## 核心机制\n\n- 【要点】说明。（适用：通用）\n",
  );
  const searchExisting = vi.fn(async (_query: string, _input: VideoKbInput) => [] as KbHit[]);
  const deps: VideoKbDeps = {
    fetchTitle: async (url: string, b?: string) => `测试视频标题 ${b ?? ""}`.trim(),
    fetchSubtitles: async () => "字幕正文：怒雷后接集分梯",
    downloadAudio,
    transcribe,
    extractKnowledge,
    searchExisting,
    now: () => new Date("2026-08-19T10:20:30Z"),
    ...over,
  };
  return { deps, downloadAudio, transcribe, extractKnowledge, searchExisting };
}

describe("video-to-kb 流程", () => {
  it("有字幕 → 直接走字幕分支，不下载音频、不转写，落盘 frontmatter 合规", async () => {
    const { deps, downloadAudio, transcribe } = makeDeps();
    const result = await runVideoToKb(input(), deps);

    expect(result.transcriptSource).toBe("subtitles");
    expect(downloadAudio).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(result.itemCount).toBe(1);

    const content = await fs.readFile(result.filePath, "utf8");
    expect(content).toContain("class: Monk");
    expect(content).toContain("spec: Windwalker");
    expect(content).toContain('dungeon: "*"');
    expect(content).toContain("patch: 12.1");
    expect(content).toContain("type: intent_pattern");
    expect(content).toContain("source_url: https://www.bilibili.com/video/BV1TEST/");
    // 文件名 = class-spec-时间戳.md
    expect(path.basename(result.filePath)).toBe("monk-windwalker-20260819-102030.md");
  });

  it("无字幕 → 下载音频并 ASR，且转写文本经术语纠错后送入提炼", async () => {
    const { deps, downloadAudio, transcribe, extractKnowledge } = makeDeps({
      fetchSubtitles: async () => null,
    });
    transcribe.mockResolvedValueOnce("天神御身前的准备：集分梯和怒雷要留好");
    const result = await runVideoToKb(input(), deps);

    expect(result.transcriptSource).toBe("asr");
    expect(downloadAudio).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(1);

    // 术语纠错生效：集分梯→疾风踢、怒雷→怒雷破 进入提示词
    const promptUser = extractKnowledge.mock.calls[0][0].user as string;
    expect(promptUser).toContain("疾风踢");
    expect(promptUser).toContain("怒雷破");
    expect(promptUser).not.toContain("集分梯");
  });

  it("检索查询 = 标题 + class/spec，并拼入已有知识参照", async () => {
    const hit: KbHit = {
      id: "x",
      chunkText: "已有：怒雷破优先",
      score: 1,
      meta: {
        class: "Monk", spec: "Windwalker", dungeon: "*", patch: "12.1",
        type: "intent_pattern", source_url: "https://example.com", origin: "curated", status: "active",
      },
    };
    const { deps, searchExisting, extractKnowledge } = makeDeps();
    searchExisting.mockResolvedValueOnce([hit]);
    await runVideoToKb(input(), deps);

    expect(searchExisting).toHaveBeenCalledTimes(1);
    const [query, passedInput] = searchExisting.mock.calls[0];
    expect(query).toContain("测试视频标题");
    expect(query).toContain("Monk");
    expect(query).toContain("Windwalker");
    expect(passedInput.class).toBe("Monk");

    const promptUser = extractKnowledge.mock.calls[0][0].user as string;
    expect(promptUser).toContain("已有：怒雷破优先");
    expect(promptUser).toContain("https://example.com");
  });
});

describe("提示词构造", () => {
  it("含四项硬性要求 + 标准名词汇表 + 转写稿", () => {
    const { system, user } = buildExtractionPrompt(
      { title: "T", cls: "Monk", spec: "Windwalker", patch: "12.1", existingKnowledge: "" },
      "转写：集分梯",
    );
    expect(system).toContain("魔兽世界");
    expect(user).toContain("只提炼视频里真实讲过的内容");
    expect(user).toContain("统一成标准名");
    expect(user).toContain("不超过 15 条");
    expect(user).toContain("## 小节名");
    expect(user).toContain("转写：集分梯");
    // 词汇表含武僧标准名（供模型对照）
    expect(renderGlossary()).toContain("疾风踢");
    expect(renderGlossary()).toContain("乾元之巅");
    expect(renderGlossary()).toContain("嗜血");
  });

  it("buildSearchQuery 空标题回退为 class/spec", () => {
    expect(buildSearchQuery("", input())).toBe("Monk Windwalker");
  });
});

describe("辅助函数", () => {
  it("sanitizeBody 去掉模型误输出的 frontmatter", () => {
    expect(sanitizeBody("---\nclass: X\n---\n\n# 标题\n正文")).toBe("# 标题\n正文");
  });

  it("countItems 只数列表行", () => {
    expect(countItems("# 标题\n\n- a\n- b\n\n## 小节\n- c")).toBe(3);
  });

  it("formatExistingKnowledge 空列表返回空串", () => {
    expect(formatExistingKnowledge([])).toBe("");
  });

  it("normalizeTerms 与管线共用同一术语词典", () => {
    expect(normalizeTerms("集分梯")).toBe("疾风踢");
  });
});
