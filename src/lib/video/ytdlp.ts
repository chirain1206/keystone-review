import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * yt-dlp 适配器（下载字幕 / 下载音频 / 读取标题）。
 * 经 child_process 调用 yt-dlp；沙箱内禁止子进程会以 EPERM 失败，此处 catch 并
 * 给出与 ingest-kb 一致的友好提示（在正常开发环境运行）。
 */

export interface YtDlpBrowserOptions {
  browser?: string;
  workDir: string;
}

function spawnYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      if ((e as NodeJS.ErrnoException).code === "EPERM") {
        reject(
          new Error(
            "当前环境禁止子进程（如 DSH 沙箱），无法调用 yt-dlp。" +
              "请在正常开发环境运行本脚本；或先手动下载字幕/音频后走人工入库。",
          ),
        );
      } else {
        reject(e);
      }
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp 退出码 ${code}：${(err || out).slice(0, 300)}`));
      } else {
        resolve(out);
      }
    });
  });
}

function browserArgs(browser?: string): string[] {
  return browser ? ["--cookies-from-browser", browser] : [];
}

/** 读取视频标题（失败返回 null，由调用方回退）。 */
export async function fetchVideoTitle(url: string, browser?: string): Promise<string | null> {
  try {
    const out = await spawnYtDlp(["--skip-download", "--no-warnings", "--print", "%(title)s", ...browserArgs(browser), url]);
    const title = out.trim().split("\n")[0]?.trim();
    return title || null;
  } catch {
    return null;
  }
}

/** 抓取字幕并转为纯文本；无字幕/失败返回 null。 */
export async function fetchSubtitles(url: string, opts: YtDlpBrowserOptions): Promise<string | null> {
  await fs.mkdir(opts.workDir, { recursive: true });
  const outDir = path.join(opts.workDir, "subs");
  await fs.mkdir(outDir, { recursive: true });
  try {
    await spawnYtDlp([
      "--skip-download",
      "--write-auto-sub",
      "--write-sub",
      "--sub-lang",
      "zh-Hans,zh-CN,zh,zh-Hant,en",
      "--sub-format",
      "vtt/srt/best",
      "-o",
      path.join(outDir, "subs.%(ext)s"),
      ...browserArgs(opts.browser),
      url,
    ]);
  } catch {
    return null;
  }
  const files = (await fs.readdir(outDir)).filter((f) => /\.(vtt|srt)$/i.test(f)).sort();
  // 优先中文，其次英文
  const preferred = files.find((f) => /zh/i.test(f)) ?? files[0];
  if (!preferred) return null;
  const raw = await fs.readFile(path.join(outDir, preferred), "utf8");
  const text = subtitleToText(raw);
  return text.trim() || null;
}

/** 下载音频（优先 m4a），返回本地文件路径。 */
export async function downloadAudio(url: string, opts: YtDlpBrowserOptions): Promise<string> {
  await fs.mkdir(opts.workDir, { recursive: true });
  const outDir = path.join(opts.workDir, "audio");
  await fs.mkdir(outDir, { recursive: true });
  // 优先 m4a 音频（体积小、无需 ffmpeg 后处理），否则取最佳音频
  await spawnYtDlp([
    "-f",
    "bestaudio[ext=m4a]/bestaudio",
    "--no-playlist",
    "-o",
    path.join(outDir, "audio.%(ext)s"),
    ...browserArgs(opts.browser),
    url,
  ]);
  const files = (await fs.readdir(outDir)).filter((f) => /\.(m4a|mp3|opus|webm|aac)$/i.test(f));
  const target = files.find((f) => /\.m4a$/i.test(f)) ?? files[0];
  if (!target) throw new Error("yt-dlp 未生成音频文件（可能视频不支持单独音频流）");
  return path.join(outDir, target);
}

/** 字幕（VTT/SRT）转纯文本：去掉头信息/时间戳/序号/内联标签。 */
export function subtitleToText(subtitle: string): string {
  const lines = subtitle.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^(WEBVTT|NOTE|Kind:|Language:)/i.test(t)) continue;
    if (/^\d{1,2}:\d{2}.*-->/.test(t)) continue; // 时间戳行
    if (/^\d+$/.test(t)) continue; // 序号行
    out.push(t.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " "));
  }
  return out.join("\n");
}
