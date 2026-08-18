import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { KbStore } from "@/lib/kb/store";
import type { KbDocument, KbHit, KbSearchFilters, KbSearchQuery } from "@/lib/kb/types";
import { KB_TOP_K_MAX } from "@/lib/kb/types";

/**
 * 开发/mock 知识库存储（T14）：本地 JSON（.data/kb_documents.json）。
 * 检索语义与 Supabase 版本对齐：
 *  - meta 过滤：class/spec/dungeon（'*' 通用）type/patch（'general' 始终命中）
 *  - 关键词评分排序（中文按双字词切分 + 英文词）
 *  - top-k 上限 5
 * 写入按 source_hash 幂等（重复执行不重复插入）。
 * 直读磁盘（同 file-repo：Next 按路由分包，多实例写后可见）。
 */

function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
}

const FILE = "kb_documents.json";

let tail: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(
    () => fn(),
    () => fn(),
  );
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function loadAll(): Promise<KbDocument[]> {
  const fp = path.join(dataDir(), FILE);
  try {
    return JSON.parse(await fs.readFile(fp, "utf8")) as KbDocument[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return [];
  }
}

async function saveAll(docs: KbDocument[]): Promise<void> {
  await withLock(async () => {
    await fs.mkdir(dataDir(), { recursive: true });
    const fp = path.join(dataDir(), FILE);
    const tmp = fp + `.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(docs), "utf8");
    await fs.rename(tmp, fp);
  });
}

/** 中文双字词 + 英文/数字词 切分。 */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const latin = text.toLowerCase().match(/[a-z0-9][a-z0-9_'-]*/g) ?? [];
  for (const w of latin) tokens.add(w);
  // 中文：逐字滑窗双字词（跳过空白/标点）
  const zh = text.replace(/[^\u4e00-\u9fff]/g, "");
  for (let i = 0; i + 1 < zh.length; i++) {
    tokens.add(zh.slice(i, i + 2));
  }
  return tokens;
}

function patchVisible(metaPatch: string, filterPatch: string | null | undefined): boolean {
  if (filterPatch === null || filterPatch === undefined || filterPatch === "") return true;
  return metaPatch === filterPatch || metaPatch === "general";
}

function dungeonVisible(metaDungeon: string, filterDungeon: string | undefined): boolean {
  if (!filterDungeon) return true;
  return metaDungeon === filterDungeon || metaDungeon === "*";
}

export class FileKbStore implements KbStore {
  async search(
    query: KbSearchQuery,
    filters: KbSearchFilters,
    topK: number,
  ): Promise<KbHit[]> {
    const docs = await loadAll();
    const qTokens = tokenize(query.text);
    const scored: { doc: KbDocument; score: number }[] = [];

    for (const doc of docs) {
      const m = doc.meta;
      if (filters.class && m.class !== filters.class) continue;
      if (filters.spec && m.spec !== filters.spec) continue;
      if (!dungeonVisible(m.dungeon, filters.dungeon)) continue;
      if (!patchVisible(m.patch, filters.patch)) continue;
      if (filters.type && m.type !== filters.type) continue;

      let score = 0;
      // meta 命中加权（只用于排序）
      if (filters.class && m.class === filters.class) score += 3;
      if (filters.spec && m.spec === filters.spec) score += 3;
      if (filters.dungeon && m.dungeon === filters.dungeon) score += 3;
      if (filters.type && m.type === filters.type) score += 2;
      // 文本关键词命中：至少一个词命中才视为检索命中（避免 meta 命中返回全库）
      const docTokens = tokenize(doc.chunkText);
      let textMatches = 0;
      for (const t of qTokens) if (docTokens.has(t)) textMatches++;
      if (textMatches === 0) continue;
      score += textMatches;
      scored.push({ doc, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.min(Math.max(topK, 1), KB_TOP_K_MAX)).map((s) => ({
      id: s.doc.id,
      chunkText: s.doc.chunkText,
      meta: s.doc.meta,
      score: s.score,
    }));
  }

  async upsert(docs: KbDocument[]): Promise<number> {
    let upserted = 0;
    await withLock(async () => {
      const all = await loadAll();
      const byHash = new Map(all.map((d) => [d.sourceHash, d]));
      for (const doc of docs) {
        const existing = byHash.get(doc.sourceHash);
        if (existing && existing.chunkText === doc.chunkText && JSON.stringify(existing.meta) === JSON.stringify(doc.meta)) {
          continue; // 完全一致 → 跳过（幂等）
        }
        byHash.set(doc.sourceHash, doc);
        upserted++;
      }
      await fs.mkdir(dataDir(), { recursive: true });
      const fp = path.join(dataDir(), FILE);
      const tmp = fp + `.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
      await fs.writeFile(tmp, JSON.stringify([...byHash.values()]), "utf8");
      await fs.rename(tmp, fp);
    });
    return upserted;
  }

  async getActivePatch(): Promise<string | null> {
    const docs = await loadAll();
    const patches = docs
      .map((d) => d.meta.patch)
      .filter((p) => p && p !== "general");
    if (patches.length === 0) return null;
    // "最新" = 数值最大（12.1 > 12.0）；非数值的按字符串排序兜底
    const numeric = patches.filter((p) => /^[\d.]+$/.test(p));
    const pick = (arr: string[]) => arr.sort((a, b) => cmpPatch(b, a))[0];
    return numeric.length ? pick(numeric) : pick(patches);
  }

  async count(): Promise<number> {
    return (await loadAll()).length;
  }
}

/** 补丁号比较（"12.1" vs "12.10"：逐段数值比较）。 */
export function cmpPatch(a: string, b: string): number {
  const as = a.split(".").map(Number);
  const bs = b.split(".").map(Number);
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i] ?? 0;
    const y = bs[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}
