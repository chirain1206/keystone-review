import { createHash, randomUUID } from "node:crypto";
import type { SuspectedVerdict } from "@/lib/ai/intent-engine";
import { embedOne } from "@/lib/kb/embedding";
import { getKbStore } from "@/lib/kb";
import { resolveActivePatch } from "@/lib/kb/retrieval";
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
  return createHash("sha256")
    .update(
      `${input.class}|${input.spec}|${verdict.key}|${verdict.evidence.replace(/\s+/g, " ").trim()}`,
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
      source_url: `https://wow-analyzer.local/inferred/${sourceHash.slice(0, 12)}`,
      origin: "inferred",
      status: "candidate",
    };
    docs.push({ id: randomUUID(), chunkText, meta, sourceHash, embedding });
  }
  return getKbStore().upsert(docs);
}
