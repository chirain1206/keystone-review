import { createHash, randomUUID } from "node:crypto";
import type { SuspectedVerdict } from "@/lib/ai/intent-engine";
import { embedOne } from "@/lib/kb/embedding";
import { getKbStore } from "@/lib/kb";
import { resolveActivePatch } from "@/lib/kb/retrieval";
import { INTERNAL_SOURCE_URL } from "@/lib/kb/ingest";
import type { KbDocument, KbMeta } from "@/lib/kb/types";

/**
 * 疑似高阶技巧沉淀（T19）：分析中发现的"知识库解释不了但证据链完整"的
 * 异常操作 → 落库为 origin=inferred、status=candidate 的候选条目。
 * 候选条目绝不注入正式分析（检索只返回 status=active）。
 * 按 source_hash 幂等：同一证据重复发现不会重复插入。
 */

export interface CandidateMetaInput {
  class: string;
  spec: string;
  dungeon: string;
}

export function candidateSourceHash(input: CandidateMetaInput, verdict: SuspectedVerdict): string {
  // L-RAG-3：哈希纳入 dungeon + origin + status，避免跨副本/跨状态的同 evidence 候选
  // 被误去重（不同来源同内容应各自独立保留，供人工分别审核转正/弃用）。
  return createHash("sha256")
    .update(
      [
        input.class,
        input.spec,
        input.dungeon,
        "inferred",
        "candidate",
        verdict.key,
        verdict.evidence.replace(/\s+/g, " ").trim(),
      ].join("|"),
    )
    .digest("hex");
}

export async function persistSuspectedCandidates(
  input: CandidateMetaInput,
  verdicts: SuspectedVerdict[],
): Promise<number> {
  if (verdicts.length === 0) return 0;
  const patch = (await resolveActivePatch()) ?? "general";
  const docs: KbDocument[] = [];
  for (const v of verdicts) {
    const chunkText = `【疑似高阶技巧】${v.explain}\n证据：${v.evidence}`;
    const sourceHash = candidateSourceHash(input, v);
    const embedding = await embedOne(chunkText);
    const meta: KbMeta = {
      class: input.class,
      spec: input.spec,
      dungeon: "*",
      patch,
      type: "intent_pattern",
      // L-RAG-2 / D4：推断条目无外部出处时用内部约定值，转正（candidate→active）时
      // 必须由人工补真实出处链接后再注入。
      source_url: INTERNAL_SOURCE_URL,
      origin: "inferred",
      status: "candidate",
    };
    docs.push({ id: randomUUID(), chunkText, meta, sourceHash, embedding });
  }
  return getKbStore().upsert(docs);
}
