/// <reference lib="webworker" />
import { parseCombatLog, type ParseResult } from "@/lib/parser/parser";

/**
 * Web Worker：分块读取 WoWCombatLog.txt（不阻塞主线程），
 * 在浏览器本地完成 FR-10 解析。原始文件永不上传服务器，
 * 主线程只拿到结构化 ParseResult。
 */

interface WorkerRequest {
  id: string;
  file: File;
}

const CHUNK_BYTES = 4 * 1024 * 1024; // 4MB 分块

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, file } = e.data;
  try {
    const decoder = new TextDecoder("utf-8");
    let text = "";
    const total = file.size;
    for (let off = 0; off < total; off += CHUNK_BYTES) {
      const buf = await file.slice(off, Math.min(off + CHUNK_BYTES, total)).arrayBuffer();
      text += decoder.decode(buf, { stream: true });
      self.postMessage({
        type: "progress",
        id,
        readBytes: Math.min(off + CHUNK_BYTES, total),
        total,
      });
    }
    text += decoder.decode(); // flush

    const result: ParseResult = parseCombatLog(text);
    self.postMessage({ type: "done", id, result });
  } catch (err) {
    self.postMessage({
      type: "error",
      id,
      message: err instanceof Error ? err.message : "解析失败",
    });
  }
};
