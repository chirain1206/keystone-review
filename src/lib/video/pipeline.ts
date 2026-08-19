import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeTerms } from "@/lib/kb/term-dict";
import { embedOne } from "@/lib/kb/embedding";
import { getKbStore } from "@/lib/kb";
import { resolveActivePatch } from "@/lib/kb/retrieval";
import { assertSafeKbText } from "@/lib/kb/ingest";
import type { ExtractionPrompt } from "@/lib/video/extract";
import { buildExtractionPrompt } from "@/lib/video/extract";
import type { KbHit } from "@/lib/kb/types";
import { KB_TOP_K_MAX } from "@/lib/kb/types";

/**
 * 视频 → 知识库候选（待审核）管线。
 * 流程：抓字幕 →（无字幕则下载音频 ASR）→ 术语纠错 → 检索同职业已有知识 →
 * DeepSeek 提炼 → 写出 kb/sources/<class>-<spec>-<时间戳>.md（仅落盘，待人工审核，
 * 不自动 ingest）。所有外部适配器（yt-dlp / ASR / DeepSeek / 检索）经依赖注入，
 * 便于单测 mock。
 */

export interface VideoKbInput {
  url: string;
  class: string;
  spec: string;
  patch: string;
  up?: string;
  /** 可选 --browser edge|chrome（yt-dlp 读浏览器 cookie）。 */
  browser?: string;
  /** kb/sources 绝对路径（输出目录）。 */
  sourcesDir: string;
  /** 工作目录（字幕/音频临时文件，.data/video-work）。 */
  workDir: string;
}

export interface VideoKbDeps {
  fetchTitle(url: string, browser?: string): Promise<string | null>;
  fetchSubtitles(url: string, opts: { browser?: string; workDir: string }): Promise<string | null>;
  downloadAudio(url: string, opts: { browser?: string; workDir: string }): Promise<string>;
  transcribe(audioPath: string): Promise<string>;
  extractKnowledge(prompt: ExtractionPrompt): Promise<string>;
  searchExisting(query: string, input: VideoKbInput): Promise<KbHit[]>;
  now(): Date;
}

export interface VideoKbResult {
  filePath: string;
  transcriptSource: "subtitles" | "asr";
  title: string;
  itemCount: number;
}

/** 检索查询文本：标题 + class/spec（与检索层语义一致）。 */
export function buildSearchQuery(title: string, input: VideoKbInput): string {
  return [title, input.class, input.spec].filter(Boolean).join(" ");
}

/** 已有知识参照格式化（拼入提示词）。 */
export function formatExistingKnowledge(hits: KbHit[]): string {
  if (hits.length === 0) return "";
  return hits
    .slice(0, KB_TOP_K_MAX)
    .map((h, i) => `[片段${i + 1}]（来源：${h.meta.source_url}）${h.chunkText}`)
    .join("\n");
}

/** 真实"检索同职业已有知识"（CLI 接线用；测试注入 mock）。 */
export async function searchExistingKnowledge(query: string, input: VideoKbInput): Promise<KbHit[]> {
  const store = getKbStore();
  const patch = (await resolveActivePatch()) ?? input.patch ?? null;
  const vector = await embedOne(query);
  return store.search(
    { text: query, vector },
    { class: input.class, spec: input.spec, patch },
    KB_TOP_K_MAX,
  );
}

function slugSpec(spec: string): string {
  return spec.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function timestamp(d: Date): string {
  // 用 UTC，保证文件名跨时区/机器稳定可复现
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/** frontmatter（与 kb/sources 源文件格式一致；origin/status 由 ingest 时目录决定）。 */
export function buildFrontmatter(input: VideoKbInput, url: string): string {
  return [
    "---",
    `class: ${input.class}`,
    `spec: ${input.spec}`,
    'dungeon: "*"',
    `patch: ${input.patch}`,
    "type: intent_pattern",
    `source_url: ${url}`,
    "---",
  ].join("\n");
}

/** 去掉模型可能误输出的 frontmatter，并计数要点条数。 */
export function sanitizeBody(body: string): string {
  const stripped = body.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
  return stripped;
}

export function countItems(body: string): number {
  return body.split("\n").filter((l) => /^\s*-\s+/.test(l)).length;
}

export async function runVideoToKb(input: VideoKbInput, deps: VideoKbDeps): Promise<VideoKbResult> {
  // 1. 标题（用于检索查询与输出 H1）
  const title = (await deps.fetchTitle(input.url, input.browser)) ??
    `${input.class} ${input.spec}${input.up ? `（${input.up}）` : ""}`.trim();

  // 2. 字幕；无字幕 → 下载音频 ASR
  let transcript = await deps.fetchSubtitles(input.url, { browser: input.browser, workDir: input.workDir });
  let source: "subtitles" | "asr" = "subtitles";
  if (!transcript || !transcript.trim()) {
    source = "asr";
    const audio = await deps.downloadAudio(input.url, { browser: input.browser, workDir: input.workDir });
    transcript = await deps.transcribe(audio);
  }
  transcript = transcript.trim();
  if (!transcript) throw new Error("未能获得字幕或转写文本，无法继续");

  // 3. 术语纠错
  const normalized = normalizeTerms(transcript);

  // 4. 检索同职业已有知识（参照）
  const hits = await deps.searchExisting(buildSearchQuery(title, input), input);
  const existing = formatExistingKnowledge(hits);

  // 5. DeepSeek 提炼
  const prompt = buildExtractionPrompt(
    {
      title,
      cls: input.class,
      spec: input.spec,
      patch: input.patch,
      up: input.up,
      existingKnowledge: existing,
    },
    normalized,
  );
  const rawBody = await deps.extractKnowledge(prompt);
  const body = sanitizeBody(rawBody);
  if (!body) throw new Error("提炼结果为空，请重试");
  // 落盘前做入库同款消毒（防控制字符/定界符样式文本混入待审核文件）
  assertSafeKbText(body, "提炼结果");

  // 6. 写出 kb/sources/<class>-<spec>-<时间戳>.md
  await fs.mkdir(input.sourcesDir, { recursive: true });
  const fileName = `${input.class.toLowerCase()}-${slugSpec(input.spec)}-${timestamp(deps.now())}.md`;
  const filePath = path.join(input.sourcesDir, fileName);
  const content = `${buildFrontmatter(input, input.url)}\n\n${body}\n`;
  await fs.writeFile(filePath, content, "utf8");

  return { filePath, transcriptSource: source, title, itemCount: countItems(body) };
}
