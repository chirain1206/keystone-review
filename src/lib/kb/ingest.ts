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

/**
 * 入库安全消毒（M-RAG-1 / L-RAG-1 / I-RAG-2）：
 *  - 定界符样式文本：随机定界符为 `【参考-<uuid>】`，历史固定定界符为
 *    `【社区攻略参考】`；另拒绝 mock 判定块 `【意图:` 混入生产内容。
 *  - 控制字符（除 \t \n 外的 C0 控制符与 DEL）。
 *  - source_url：仅 http(s) 或内部约定值，长度 ≤500。
 */

/** 推断来源（inferred）条目无外部出处时的内部约定 source_url（ingest 放行该值）。 */
export const INTERNAL_SOURCE_URL = "internal:inference";

/** 入库内容不得含此类序列（定界符/判定块样式，防提示词注入）。 */
export const DELIMITER_PATTERN_RE = /【(?:社区攻略参考|\/社区攻略参考|参考-|\/参考-|意图:)/;

/** 控制字符（除水平制表符 \t 与换行 \n 外）。 */
export const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

const MAX_SOURCE_URL_CHARS = 500;

/** 校验知识文本（chunk_text / source_url）不含控制字符与定界符样式文本。 */
export function assertSafeKbText(value: string, label: string): void {
  if (CONTROL_CHAR_RE.test(value)) {
    throw new Error(`${label} 含控制字符，已拒绝入库`);
  }
  if (DELIMITER_PATTERN_RE.test(value)) {
    throw new Error(`${label} 含定界符/判定块样式文本，已拒绝入库（防提示词注入）`);
  }
}

/** 校验 source_url：长度、内容安全、协议（http/https 或内部约定值）。 */
export function assertSafeSourceUrl(url: string, label: string): void {
  assertSafeKbText(url, label);
  if (url.length > MAX_SOURCE_URL_CHARS) {
    throw new Error(`${label} 超过 ${MAX_SOURCE_URL_CHARS} 字符上限，已拒绝入库`);
  }
  if (!/^https?:\/\//.test(url) && url !== INTERNAL_SOURCE_URL) {
    throw new Error(`${label} 必须是 http(s) 链接或 ${INTERNAL_SOURCE_URL}`);
  }
}

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
  /** 文件级 frontmatter（不含 origin/status，用于哈希与目录级覆写） */
  frontmatter: Record<string, string>;
  meta: KbMeta;
  chunks: { text: string; title: string; meta: KbMeta }[];
}

/** 校验并解析单个 kb 源文件（origin/status 由入库目录在 runIngest 覆写）。 */
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
    // origin/status 由入库目录决定（kb/sources → curated/active；
    // kb/inferred → inferred/candidate），不读 frontmatter。
    origin: "curated",
    status: "active",
  };
  assertSafeSourceUrl(meta.source_url, `kb/sources/${fileName}: source_url`);

  const sections = splitSections(body);
  const chunks = sections.flatMap((s) => {
    // 节内覆写 source_url 同样做安全校验
    if (s.overrides.source_url !== undefined) {
      assertSafeSourceUrl(s.overrides.source_url, `kb/sources/${fileName}: 节内 source_url`);
    }
    return splitLongSection(s.body).map((text) => {
      // 入库消毒：拒绝含定界符/判定块样式文本与控制字符的片段（防提示词注入）
      assertSafeKbText(text, `kb/sources/${fileName}: 片段「${s.title || "正文"}」`);
      return {
        text,
        title: s.title,
        meta: { ...meta, ...s.overrides },
      };
    });
  });
  return { fileName, frontmatter: data, meta, chunks };
}

export interface IngestOptions {
  /** 入库目录决定的来源标记（缺省 curated）。 */
  origin: KbMeta["origin"];
  /** 入库目录决定的状态标记（缺省 active）。 */
  status: KbMeta["status"];
}

/** 主入库流程：目录下所有 .md → 解析 → 嵌入 → upsert（origin/status 由目录决定）。 */
export async function runIngest(
  sourcesDir: string,
  options: IngestOptions = { origin: "curated", status: "active" },
): Promise<IngestStats> {
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
        const finalMeta: KbMeta = {
          ...c.meta,
          origin: options.origin,
          status: options.status,
        };
        // source_hash 含 origin/status：同一内容在 curated 与 inferred
        // 两个目录互不覆盖（不同哈希、独立条目）。
        const hashMeta: Record<string, string> = {
          ...parsed.frontmatter,
          ...Object.fromEntries(Object.entries(finalMeta).filter(([, v]) => typeof v === "string")),
        };
        allDocs.push({
          id: randomUUID(),
          chunkText: c.text,
          meta: finalMeta,
          sourceHash: computeSourceHash(entry, hashMeta, c.text),
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
