"use client";

/**
 * SSE 客户端解析器：fetch 流式响应 → 事件回调（T5/T7/T12 共用）。
 */
export async function readSseStream(
  res: Response,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  if (!res.body) throw new Error("响应不支持流式读取");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      let event = "message";
      let dataStr = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataStr += line.slice(6);
      }
      if (!dataStr) continue;
      let data: unknown = dataStr;
      try {
        data = JSON.parse(dataStr);
      } catch {
        // 非 JSON 数据原样传递
      }
      onEvent(event, data);
    }
  }
}
