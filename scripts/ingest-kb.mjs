#!/usr/bin/env node
/**
 * 知识库入库脚本（T15，FR-11）。
 * 用法：
 *   node scripts/ingest-kb.mjs            # 入库 kb/sources/*.md（默认）
 *   node scripts/ingest-kb.mjs <目录>     # 指定目录
 * 幂等：按 source_hash 去重，重复执行不重复插入。
 * 嵌入：配置 EMBEDDING_API_KEY 走 SiliconFlow bge-m3；未配置用确定性 mock 向量（开发自测）。
 */
import "tsx/esm";
import { fileURLToPath } from "node:url";
import path from "node:path";

process.on("uncaughtException", (err) => {
  if (err && (err.code === "EPERM" || String(err.message).includes("spawn"))) {
    console.error(
      "[ingest-kb] 当前环境禁止子进程（如 DSH 沙箱），无法启动 tsx 转换器。" +
        "请在正常开发环境运行本脚本；沙箱内等价验证由 src/lib/kb/ingest.test.ts 覆盖（runIngest 全链路+幂等）。",
    );
    process.exit(1);
  }
  throw err;
});

const { runIngest } = await import("../src/lib/kb/ingest.ts");
const { envConfig } = await import("../src/lib/env.ts");
const { getKbStore } = await import("../src/lib/kb/index.ts");

const argDir = process.argv[2];
const root = argDir ? path.resolve(argDir) : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "kb");

// 两个源目录（互不覆盖）：curated→active / inferred→candidate
const targets = argDir
  ? [{ dir: root, origin: "curated", status: "active", label: argDir }]
  : [
      { dir: path.join(root, "sources"), origin: "curated", status: "active", label: "kb/sources" },
      { dir: path.join(root, "inferred"), origin: "inferred", status: "candidate", label: "kb/inferred" },
    ];

console.log(`[ingest-kb] 嵌入后端：${envConfig.embeddingEnabled ? `${envConfig.embeddingModel}（真实）` : "mock 确定性伪向量（未配置 EMBEDDING_API_KEY）"}`);

let totalFiles = 0;
let totalChunks = 0;
let totalUpserted = 0;
let totalSkipped = 0;
const allErrors = [];
for (const t of targets) {
  console.log(`[ingest-kb] 目录 ${t.label} → origin=${t.origin}, status=${t.status}`);
  const stats = await runIngest(t.dir, { origin: t.origin, status: t.status });
  totalFiles += stats.files;
  totalChunks += stats.chunks;
  totalUpserted += stats.upserted;
  totalSkipped += stats.skipped;
  allErrors.push(...stats.errors);
}
console.log(
  `[ingest-kb] 完成：文件 ${totalFiles}，片段 ${totalChunks}，入库/更新 ${totalUpserted}，跳过（幂等）${totalSkipped}，错误 ${allErrors.length}`,
);
for (const e of allErrors) console.error(`[ingest-kb] 错误：${e}`);

const total = await getKbStore().count();
const activePatch = envConfig.activePatch || (await getKbStore().getActivePatch());
console.log(`[ingest-kb] 库内片段总数：${total}；活跃补丁：${activePatch ?? "（空库）"}`);

process.exit(allErrors.length > 0 ? 1 : 0);
