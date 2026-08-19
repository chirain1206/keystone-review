import { promises as fs } from "node:fs";
import path from "node:path";
import { envConfig } from "@/lib/env";

/**
 * 语音转写适配器（SiliconFlow SenseVoiceSmall，OpenAI 兼容 transcriptions 协议）。
 *  - multipart POST {baseUrl}/v1/audio/transcriptions（file + model）
 *  - 复用 SiliconFlow 密钥/域名（与 embedding 同一供应商 EMBEDDING_API_KEY/BASE_URL）
 *  - 仅支持 ≤20MB 音频：超限抛错提示分段（首版不自动切分）
 */

export const ASR_MAX_BYTES = 20 * 1024 * 1024;

/** SenseVoiceSmall 官方模型 id（可用 ASR_MODEL 覆盖）。 */
export const ASR_MODEL = process.env.ASR_MODEL || "FunAudioLLM/SenseVoiceSmall";

const MIME_BY_EXT: Record<string, string> = {
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
};

export interface AsrOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

function mimeOf(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/** 转写单个音频文件，返回纯文本。真实调用；失败抛带上下文的友好错误。 */
export async function transcribeAudioFile(audioPath: string, opts: AsrOptions = {}): Promise<string> {
  const stat = await fs.stat(audioPath).catch(() => {
    throw new Error(`音频文件不存在：${audioPath}`);
  });
  if (stat.size > ASR_MAX_BYTES) {
    throw new Error(
      `音频 ${Math.round(stat.size / 1024 / 1024)}MB 超过 20MB 上限，暂不支持自动分段，请先用工具切分后再转写`,
    );
  }
  const apiKey = opts.apiKey ?? envConfig.embeddingApiKey;
  if (!apiKey) {
    throw new Error("未配置 EMBEDDING_API_KEY（SiliconFlow），无法转写；请配置后重试");
  }
  const baseUrl = (opts.baseUrl ?? envConfig.embeddingBaseUrl).replace(/\/$/, "");
  const url = `${baseUrl}/v1/audio/transcriptions`;

  const bytes = await fs.readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeOf(audioPath) }), path.basename(audioPath));
  form.append("model", opts.model ?? ASR_MODEL);

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 上游细节只进服务端日志，抛给调用方友好文案
    console.error(`[video:asr] 转写服务 ${res.status}: ${body.slice(0, 300)}`);
    throw new Error("语音转写服务暂时不可用，请稍后重试");
  }
  const raw = await res.text();
  let text = "";
  try {
    const data = JSON.parse(raw) as { text?: string } | string;
    text = typeof data === "string" ? data : (data.text ?? "");
  } catch {
    text = raw.trim();
  }
  if (!text) throw new Error("语音转写返回为空（可能音频无声或格式不支持）");
  return text;
}
