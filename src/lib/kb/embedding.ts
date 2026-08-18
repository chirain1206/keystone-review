import { envConfig } from "@/lib/env";

/**
 * 嵌入服务适配器（T15，FR-11）。
 *  - 有 EMBEDDING_API_KEY → SiliconFlow bge-m3（OpenAI 兼容协议：
 *    POST {EMBEDDING_BASE_URL}/v1/embeddings，输出 1024 维）
 *  - 无密钥（开发/mock）→ 确定性伪向量（同文本恒得同向量，便于本地调试；
 *    生产 fail-fast 已由 validateProductionEnv 覆盖，禁止静默 mock）
 */

export const EMBEDDING_DIM = 1024;

/** 请求 OpenAI 兼容嵌入接口；返回按输入顺序的向量数组。 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!envConfig.embeddingEnabled) {
    return texts.map((t) => mockEmbedding(t));
  }
  const url = `${envConfig.embeddingBaseUrl.replace(/\/$/, "")}/v1/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${envConfig.embeddingApiKey}`,
    },
    body: JSON.stringify({ model: envConfig.embeddingModel, input: texts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[kb] 嵌入服务 ${res.status}: ${body.slice(0, 300)}`);
    throw new Error("嵌入服务暂时不可用，请稍后重试");
  }
  const data = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
  if (!Array.isArray(data.data)) throw new Error("嵌入服务响应格式异常");
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  const vectors = sorted.map((d) => d.embedding);
  if (vectors.length !== texts.length) throw new Error("嵌入服务返回数量与输入不一致");
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIM) {
      throw new Error(`嵌入维度异常：期望 ${EMBEDDING_DIM}，实得 ${v.length}`);
    }
  }
  return vectors;
}

export async function embedOne(text: string): Promise<number[]> {
  return (await embedTexts([text]))[0];
}

/**
 * mock 确定性伪向量：FNV-1a 哈希播种的归一化 1024 维向量。
 * 同一文本在任何环境恒得相同向量（仅本地开发/测试用，不参与生产语义检索）。
 */
export function mockEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM);
  let h1 = 0x811c9dc5;
  let h2 = 0xc9dc5118;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (c + 1), 16777619) >>> 0;
  }
  let sumSq = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    let x = (h1 + Math.imul(i + 1, 2654435761) + Math.imul(h2, i + 7)) >>> 0;
    x = (x % 2000) / 1000 - 1; // [-1, 1)
    vec[i] = x;
    sumSq += x * x;
  }
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < EMBEDDING_DIM; i++) vec[i] /= norm;
  return vec;
}
