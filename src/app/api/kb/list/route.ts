import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/provider";
import { authorizeExpert } from "@/lib/expert";
import { getKbStore } from "@/lib/kb";
import type { KbListFilter, KbMeta } from "@/lib/kb/types";

export const maxDuration = 30;

const STATUSES: ReadonlySet<string> = new Set(["active", "candidate", "deprecated"]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /api/kb/list —— 专家知识库浏览（只读），仅白名单可用。
 * 查询参数（均可选）：patch / status / class / q（关键词，匹配片段文本）/ limit（默认 50，上限 200）。
 * 复用 KbStore.list 做 patch/status/class 过滤，关键词与 limit 在服务端收敛。
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.json<{ ok: boolean; error?: string }>({ ok: false });
  const user = await getCurrentUser(req, res);
  const gate = authorizeExpert(user);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const sp = req.nextUrl.searchParams;
  const filter: KbListFilter = {};
  const patch = sp.get("patch")?.trim();
  const status = sp.get("status")?.trim();
  const cls = sp.get("class")?.trim();
  const q = sp.get("q")?.trim().toLowerCase();
  const limitRaw = Number(sp.get("limit") ?? "");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
    : DEFAULT_LIMIT;

  if (patch) filter.patch = patch;
  if (status && STATUSES.has(status)) filter.status = status as KbMeta["status"];
  if (cls) filter.class = cls;

  try {
    let rows = await getKbStore().list(filter);
    if (q) {
      rows = rows.filter((r) => r.chunkText.toLowerCase().includes(q));
    }
    return NextResponse.json({ ok: true, items: rows.slice(0, limit) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
