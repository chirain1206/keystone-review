import { createHash, randomUUID } from "node:crypto";
import { embedOne } from "@/lib/kb/embedding";
import { getKbStore } from "@/lib/kb";
import { resolveActivePatch } from "@/lib/kb/retrieval";
import { assertSafeKbText, assertSafeSourceUrl, INTERNAL_SOURCE_URL, normalizeText } from "@/lib/kb/ingest";
import type { KbDocument, KbDuplicateHint, KbMeta } from "@/lib/kb/types";

/**
 * 专家社区知识提交与审核（FR-11 增强）。
 *  - 提交：校验 + 消毒 + 生成 source_hash + 嵌入（无密钥时 mock 向量）→
 *    写入 origin=community、status=candidate（候选绝不注入正式分析）。
 *  - 审核：candidate → active（通过）或 deprecated（驳回），复用 KbStore.updateStatus，
 *    并写审计字段 meta.reviewed_by/at。
 */

export const MAX_TITLE_CHARS = 200;
export const MAX_CONTENT_CHARS = 8000;

export interface CommunitySubmitInput {
  class: string;
  spec: string;
  title: string;
  content: string;
  sourceUrl?: string;
}

export interface SubmitResult {
  id: string;
  patch: string;
  /** 疑似重复的已生效条目（相似度 ≥ 阈值），提交时随响应返回供前端提示。 */
  duplicates: KbDuplicateHint[];
}

/** 标题 + 内容合并为单片段文本（知识库无独立 title 字段，标题作为正文首行）。 */
export function buildCommunityChunkText(title: string, content: string): string {
  return `${title}\n${content}`;
}

/** 幂等哈希：同职业/专精/出处/内容 重复提交 → 同一 hash，upsert 跳过。 */
export function communitySourceHash(
  cls: string,
  spec: string,
  sourceUrl: string,
  chunkText: string,
): string {
  return createHash("sha256")
    .update([cls, spec, sourceUrl, normalizeText(chunkText)].join("|"))
    .digest("hex");
}

/** 疑似重复判定阈值：相似度 ≥ 0.75 视为"疑似重复"（Supabase 余弦相似度 0–1）。 */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.75;

/** 疑似重复的 top-k 候选数。 */
const DUPLICATE_TOP_K = 3;

/** 摘要截断长度（字符）。 */
const DUPLICATE_SUMMARY_MAX = 100;

/** 片段首行视为"标题"（社区提交把标题作为正文首行，见 buildCommunityChunkText）。 */
function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  const value = line || text;
  return value.length > 80 ? value.slice(0, 80) + "…" : value;
}

function summarize(text: string, max = DUPLICATE_SUMMARY_MAX): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? normalized.slice(0, max) + "…" : normalized;
}

/**
 * 提交查重：对新内容做向量相似度检索（复用 embedding + KbStore.search），
 * 只与同职业 + 当前补丁的已生效（status=active）条目比对，取 top-k，
 * 相似度 ≥ 阈值者返回为"疑似重复"提示。不阻塞提交（仅提示）。
 * 说明：Supabase 的 score 即余弦相似度（0–1）；FileKbStore（mock/开发）的 score
 * 为关键词加权命中分（≥1 即命中），同一阈值在 mock 下更激进，仅用于本地联调。
 */
export async function findDuplicateCandidates(
  text: string,
  vector: number[],
  cls: string,
  patch: string,
  topK = DUPLICATE_TOP_K,
): Promise<KbDuplicateHint[]> {
  const store = getKbStore();
  const hits = await store.search(
    { text, vector },
    { class: cls, patch, status: "active" },
    topK,
  );
  return hits
    .filter((h) => h.score >= DUPLICATE_SIMILARITY_THRESHOLD)
    .map((h) => ({
      id: h.id,
      title: firstLine(h.chunkText),
      summary: summarize(h.chunkText),
      score: Math.round(h.score * 1000) / 1000,
    }));
}

/** 提交社区知识（origin=community、status=candidate）；校验失败抛中文友好错误。 */
export async function submitCommunityKnowledge(
  input: CommunitySubmitInput,
  submitterEmail: string,
  opts: { now?: () => Date } = {},
): Promise<SubmitResult> {
  const cls = input.class.trim();
  const spec = input.spec.trim();
  const title = input.title.trim();
  const content = input.content.trim();
  const sourceUrl = (input.sourceUrl ?? "").trim() || INTERNAL_SOURCE_URL;

  if (!cls) throw new Error("职业不能为空");
  if (!spec) throw new Error("专精不能为空");
  if (!title) throw new Error("标题不能为空");
  if (title.length > MAX_TITLE_CHARS) throw new Error(`标题超过 ${MAX_TITLE_CHARS} 字符上限`);
  if (!content) throw new Error("内容不能为空");
  if (content.length > MAX_CONTENT_CHARS) throw new Error(`内容超过 ${MAX_CONTENT_CHARS} 字符上限`);

  // 消毒：拒绝控制字符 / 定界符样式文本 / 非法 source_url
  assertSafeKbText(title, "标题");
  assertSafeKbText(content, "内容");
  assertSafeSourceUrl(sourceUrl, "source_url");

  const patch = (await resolveActivePatch()) ?? "general";
  const chunkText = buildCommunityChunkText(title, content);
  const sourceHash = communitySourceHash(cls, spec, sourceUrl, chunkText);
  const embedding = await embedOne(chunkText);

  // 查重：与同职业 + 当前补丁的已生效条目比对（不阻塞，仅提示）
  const duplicates = await findDuplicateCandidates(chunkText, embedding, cls, patch);

  const meta: KbMeta = {
    class: cls,
    spec,
    dungeon: "*",
    patch,
    type: "intent_pattern",
    source_url: sourceUrl,
    origin: "community",
    status: "candidate",
    submitted_by: submitterEmail,
    submitted_at: (opts.now ?? (() => new Date()))().toISOString(),
    // 疑似重复的已生效条目存候选 meta，供审核页直接展示（提交时快照，信息准确）
    ...(duplicates.length > 0 ? { duplicates } : {}),
  };
  const doc: KbDocument = { id: randomUUID(), chunkText, meta, sourceHash, embedding };
  await getKbStore().upsert([doc]);
  return { id: doc.id, patch, duplicates };
}

export type ReviewAction = "approve" | "reject";

export interface ReviewResult {
  status: KbMeta["status"];
}

/** 审核候选：approve→active / reject→deprecated，并写审计字段。 */
export async function reviewCandidate(
  id: string,
  action: ReviewAction,
  reviewerEmail: string,
  opts: { now?: () => Date } = {},
): Promise<ReviewResult> {
  const store = getKbStore();
  const rows = await store.list({ idPrefix: id });
  if (rows.length === 0) throw new Error("未找到该条目");
  if (rows.length > 1) throw new Error("id 不唯一，无法审核");
  const row = rows[0];
  if (row.meta.status !== "candidate") {
    throw new Error(`该条目当前状态为 ${row.meta.status}，不是候选，无法审核`);
  }
  const status: KbMeta["status"] = action === "approve" ? "active" : "deprecated";
  const reviewedAt = (opts.now ?? (() => new Date()))().toISOString();
  await store.updateStatus([id], status, { reviewedBy: reviewerEmail, reviewedAt });
  return { status };
}
