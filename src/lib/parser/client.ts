"use client";

import type { ParseResult } from "@/lib/parser/parser";

/**
 * 主线程侧解析入口：spawn Web Worker，把 File 交给 worker 分块解析。
 * 使用方式（组件内）：
 *   const result = await parseFileInWorker(file, (read, total) => setProgress(...));
 */

export interface ParseProgress {
  readBytes: number;
  total: number;
}

export function parseFileInWorker(
  file: File,
  onProgress?: (p: ParseProgress) => void,
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url));
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; id: string; readBytes?: number; total?: number; result?: ParseResult; message?: string };
      if (msg.id !== id) return;
      if (msg.type === "progress") {
        onProgress?.({ readBytes: msg.readBytes ?? 0, total: msg.total ?? file.size });
        return;
      }
      worker.terminate();
      if (msg.type === "done" && msg.result) resolve(msg.result);
      else reject(new Error(msg.message ?? "解析失败"));
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || "解析 Worker 异常"));
    };

    worker.postMessage({ id, file });
  });
}
