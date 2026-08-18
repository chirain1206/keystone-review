import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { embedTexts } from "@/lib/kb/embedding";
import { getKbStore } from "@/lib/kb";
import type { KbDocument, KbMeta } from "@/lib/kb/types";

/**
 * 知识库入库管线（T15，FR-11）。
 *  - 读取 kb/sources/*.md：frontmatter（class/spec/dungeon/patch/type/source_url 必填）
 *    + 正文按 "## " 分节切块（每节 = 一个片段；超长节按段落再切）
 *  - 每节支持可选覆写注释 `<!-- key: value -->`（dungeon/type/source_url）
 *  - 逐块计算 source_hash（sha256 归一化内容）→ 嵌入 → upsert（按 hash 幂等）
 *  - 重复执行不重复插入（内容一致的块跳过）
 */

export const REQUIRED_FRONTMATTER = [
  "class",
  "spec",
  "dungeon",
  "patch",
  "type",
  "source_url",
] as const;

export interface IngestStats {
  files: number;
  chunks: number;
  upserted: number;
  skipped: number;
  errors: string[];
}

const MAX_CHUNK_CHARS = 1200;

interface ParsedSection {
  title: string;
  body: string;
  overrides: Partial<Pick<KbMeta, "dungeon" | "type" | "source_url">>;
}

export function parseFrontmatter(content: string): {
  data: Record<string, string>;
  body: string;
} {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(content);
  if (!m) {
    return { data: {}, body: content };
  }
  const data: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf(":");
    if (idx <= 0) continue;
    const key = t.slice(0, idx).trim();
    let value = t.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, body: content.slice(m[0].length) };
}

/** 按 "## " 分节 + 节内覆写注释解析；文件级 "# " 标题视为文件题名（非内容）。 */
export function splitSections(body: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const parts = body.split(/^##\s+/m);
  const intro = (parts.shift() ?? "")
    .split("\n")
    .filter((l) => !/^#\s+/.test(l.trim()))
    .join("\n")
    .trim();
  if (intro) {
    sections.push({ title: "", body: intro, overrides: {} });
  }
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const title = (nl >= 0 ? part.slice(0, nl) : part).trim();
    const bodyText = (nl >= 0 ? part.slice(nl + 1) : "").trim();
    if (!bodyText) continue;
    const overrides: ParsedSection["overrides"] = {};
    let cleaned = bodyText;
    const overrideRe = /^<!--\s*([a-z_]+)\s*:\s*(.+?)\s*-->\s*$/gm;
    cleaned = cleaned.replace(overrideRe, (_, key: string, value: string) => {
      if (key === "dungeon" || key === "type" || key === "source_url") {
        overrides[key] = value.trim();
      }
      return "";
    });
    sections.push({ title, body: cleaned.trim(), overrides });
  }
  return sections.filter((s) => s.body);
}

/** 长节按段落再切（≤ MAX_CHUNK_CHARS），尽量保持段落完整。 */
export function splitLongSection(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const paras = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > MAX_CHUNK_CHARS && cur) {
      chunks.push(cur.trim());
      cur = p;
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function computeSourceHash(fileName: string, frontmatter: Record<string, string>, chunkText: string): string {
  return createHash("sha256")
    .update(`${fileName}\n${JSON.stringify(frontmatter)}\n${normalizeText(chunkText)}`)
    .digest("hex");
}

export interface ParsedFile {
  fileName: string;
  meta: KbMeta;
  chunks: { text: string; sourceHash: string; title: string; meta: KbMeta }[];
}

/** 校验并解析单个 kb 源文件。 */
export function parseKbFile(fileName: string, content: string): ParsedFile {
  const { data, body } = parseFrontmatter(content);
  const missing = REQUIRED_FRONTMATTER.filter((k) => !data[k]?.trim());
  if (missing.length > 0) {
    throw new Error(`kb/sources/${fileName}: frontmatter 缺少必填字段：${missing.join(", ")}`);
  }
  const meta: KbMeta = {
    class: data.class.trim(),
    spec: data.spec.trim(),
    dungeon: data.dungeon.trim(),
    patch: data.patch.trim(),
    type: data.type.trim(),
    source_url: data.source_url.trim(),
  };
  if (!/^https?:\/\//.test(meta.source_url)) {
    throw new Error(`kb/sources/${fileName}: source_url 必须是 http(s) 链接`);
  }

  const sections = splitSections(body);
  const chunks = sections.flatMap((s) =>
    splitLongSection(s.body).map((text) => ({
      text,
      title: s.title,
      meta: { ...meta, ...s.overrides },
      sourceHash: computeSourceHash(fileName, { ...data, ...s.overrides }, text),
    })),
  );
  return { fileName, meta, chunks };
}

/** 主入库流程：目录下所有 .md → 解析 → 嵌入 → upsert。 */
export async function runIngest(sourcesDir: string): Promise<IngestStats> {
  const stats: IngestStats = { files: 0, chunks: 0, upserted: 0, skipped: 0, errors: [] };
  let entries: string[];
  try {
    entries = (await fs.readdir(sourcesDir)).filter((f) => f.endsWith(".md"));
  } catch (err) {
    stats.errors.push(`无法读取知识源目录 ${sourcesDir}`);
    return stats;
  }
  const allDocs: KbDocument[] = [];

  for (const entry of entries.sort()) {
    stats.files++;
    try {
      const content = await fs.readFile(path.join(sourcesDir, entry), "utf8");
      const parsed = parseKbFile(entry, content);
      for (const c of parsed.chunks) {
        allDocs.push({
          id: randomUUID(),
          chunkText: c.text,
          meta: c.meta,
          sourceHash: c.sourceHash,
          embedding: new Array(1024).fill(0), // 下方批量嵌入回填
        });
      }
    } catch (err) {
      stats.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  stats.chunks = allDocs.length;
  if (allDocs.length === 0) {
    if (stats.errors.length === 0) stats.errors.push("没有可入库的片段");
    return stats;
  }

  // 批量嵌入（mock 模式为确定性伪向量；真实模式调 SiliconFlow）
  const vectors = await embedTexts(allDocs.map((d) => d.chunkText));
  for (let i = 0; i < allDocs.length; i++) {
    allDocs[i].embedding = vectors[i];
  }

  const upserted = await getKbStore().upsert(allDocs);
  stats.upserted = upserted;
  stats.skipped = allDocs.length - upserted;
  return stats;
}
