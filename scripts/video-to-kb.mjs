#!/usr/bin/env node
/**
 * 视频 → 知识库候选（待审核）工具。
 * 用法：
 *   npx tsx scripts/video-to-kb.mjs <B站URL> --class Monk --spec Windwalker --patch 12.1 [--up 作者名] [--browser edge|chrome]
 * 流程：yt-dlp 抓字幕 →（失败则下载音频 + SiliconFlow ASR）→ 术语纠错 → 检索同职业
 * 已有知识作参照 → DeepSeek 提炼 → 写出 kb/sources/<class>-<spec>-<时间戳>.md。
 * 输出仅落盘为待审核文件，不自动 ingest；请主 Agent 与专家审核后再入库。
 */
import "tsx/esm";
import { fileURLToPath } from "node:url";
import path from "node:path";

process.on("uncaughtException", (err) => {
  if (err && (err.code === "EPERM" || String(err.message).includes("spawn"))) {
    console.error(
      "[video-to-kb] 当前环境禁止子进程（如 DSH 沙箱），无法调用 yt-dlp/tsx。" +
        "请在正常开发环境运行本脚本；等价逻辑由 src/lib/video/pipeline.test.ts 覆盖。",
    );
    process.exit(1);
  }
  throw err;
});

const { runVideoToKb, searchExistingKnowledge } = await import("../src/lib/video/pipeline.ts");
const { fetchVideoTitle, fetchSubtitles, downloadAudio } = await import("../src/lib/video/ytdlp.ts");
const { transcribeAudioFile } = await import("../src/lib/video/asr.ts");
const { extractKnowledge } = await import("../src/lib/video/extract.ts");

// ---- 参数解析 ----
const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith("--"));
function flag(name, argv) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= argv.length) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}
const cls = flag("class", argv);
const spec = flag("spec", argv);
const patch = flag("patch", argv);
const up = flag("up", argv);
const browser = flag("browser", argv);

if (!url || !cls || !spec || !patch) {
  console.error(
    "用法：npx tsx scripts/video-to-kb.mjs <B站URL> --class Monk --spec Windwalker --patch 12.1 [--up 作者名] [--browser edge|chrome]",
  );
  process.exit(2);
}
if (browser && !["edge", "chrome"].includes(browser)) {
  console.error("--browser 仅支持 edge / chrome");
  process.exit(2);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const input = {
  url,
  class: cls,
  spec,
  patch,
  up,
  browser,
  sourcesDir: path.join(root, "kb", "sources"),
  workDir: path.join(root, ".data", "video-work"),
};

const deps = {
  fetchTitle: (u, b) => fetchVideoTitle(u, b),
  fetchSubtitles: (u, o) => fetchSubtitles(u, o),
  downloadAudio: (u, o) => downloadAudio(u, o),
  transcribe: (audioPath) => transcribeAudioFile(audioPath),
  extractKnowledge,
  searchExisting: searchExistingKnowledge,
  now: () => new Date(),
};

try {
  console.log(`[video-to-kb] 处理视频：${url}`);
  console.log(`[video-to-kb] 职业/专精：${cls} / ${spec}；补丁：${patch}`);
  const result = await runVideoToKb(input, deps);
  console.log(`[video-to-kb] 转写来源：${result.transcriptSource === "subtitles" ? "字幕" : "ASR"}`);
  console.log(`[video-to-kb] 标题：${result.title}`);
  console.log(`[video-to-kb] 提炼要点：${result.itemCount} 条`);
  console.log(`[video-to-kb] 已写出待审核文件：${result.filePath}`);
  console.log("[video-to-kb] ⚠️ 请主 Agent 与专家审核后再 ingest（node scripts/ingest-kb.mjs）。");
} catch (err) {
  console.error(`[video-to-kb] 失败：${err instanceof Error ? err.message : String(err)}`);
  console.error("[video-to-kb] 重试建议：检查 yt-dlp 是否安装、URL 是否可访问、密钥是否配置（EMBEDDING_API_KEY / DEEPSEEK_API_KEY）；大文件请先切分。");
  process.exit(1);
}
