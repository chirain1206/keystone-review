const encoder = new TextEncoder();

/**
 * SSE 输出封装（T5）：路由处理器把生成进度/章节增量汇成一条 SSE 流。
 * 事件格式：
 *   event: status   data: {"chapterNo":n,"status":"running|done|failed"}
 *   event: delta    data: {"chapterNo":n,"delta":"..."}
 *   event: done     data: {"reportId":"...","status":"ready|failed"}
 *   event: error    data: {"message":"..."}
 */
export class SseWriter {
  private closed = false;

  constructor(private controller: ReadableStreamDefaultController<Uint8Array>) {}

  send(event: string, data: unknown): void {
    if (this.closed) return;
    try {
      this.controller.enqueue(
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      );
    } catch {
      this.closed = true;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.close();
    } catch {
      // 已关闭
    }
  }
}

export function createSseResponse(
  run: (writer: SseWriter) => Promise<void>,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const writer = new SseWriter(controller);
      // 立即写一段注释保持连接（绕过代理缓冲）
      controller.enqueue(encoder.encode(": connected\n\n"));
      run(writer).catch((err) => {
        writer.send("error", { message: err instanceof Error ? err.message : "服务异常" });
        writer.close();
      });
    },
    cancel() {
      // 客户端断开：生成继续（章节落库），只是不再推送
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
