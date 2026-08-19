import { createHash, randomUUID } from "node:crypto";
import { embedOne } from "@/lib/kb/embedding";
import { getKbStore } from "@/lib/kb";
import { resolveActivePatch } from "@/lib/kb/retrieval";
import { assertSafeKbText, assertSafeSourceUrl, INTERNAL_SOURCE_URL, normalizeText } from "@/lib/kb/ingest";
import type { KbDocument, KbMeta } from "@/lib/kb/types";

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
  };
  const doc: KbDocument = { id: randomUUID(), chunkText, meta, sourceHash, embedding };
  await getKbStore().upsert([doc]);
  return { id: doc.id, patch };
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
