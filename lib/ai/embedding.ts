import 'server-only';

/**
 * 向量化（embedding）抽象层。
 *
 * 用于客服知识库的语义检索。提供两种实现：
 * 1. LocalHashEmbedder：零外部依赖的本地哈希向量（降级方案，用于无 API Key 场景）
 * 2. OpenAiEmbedder：调用 OpenAI embedding 接口（需 AI_API_KEY）
 *
 * 向量统一为 number[]，余弦相似度检索。
 */

export interface Embedder {
  readonly name: string;
  embed(text: string): Promise<number[]>;
}

/**
 * 本地哈希向量：把文本分词后哈希映射到固定维度向量。
 * 语义能力弱于真实 embedding，但能捕捉关键词重叠，作为无 API 时的降级。
 */
class LocalHashEmbedder implements Embedder {
  readonly name = 'local-hash';
  private readonly dim = 256;

  private tokenize(text: string): string[] {
    // 中文按字符切分 + 英文按词切分（简化）
    const lower = text.toLowerCase();
    const tokens: string[] = [];
    const cjk = lower.match(/[\u4e00-\u9fa5]/g) ?? [];
    const words = lower.match(/[a-z0-9]+/g) ?? [];
    // 中文用 bigram 增强语义
    for (let i = 0; i < cjk.length - 1; i++) {
      tokens.push(cjk[i] + cjk[i + 1]);
    }
    tokens.push(...cjk, ...words);
    return tokens;
  }

  private hash(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) | 0;
    }
    return h;
  }

  async embed(text: string): Promise<number[]> {
    const vec = new Array(this.dim).fill(0);
    const tokens = this.tokenize(text);
    for (const token of tokens) {
      const idx = Math.abs(this.hash(token)) % this.dim;
      vec[idx] += 1;
    }
    // L2 归一化
    const norm = Math.sqrt(vec.reduce((a, v) => a + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

/**
 * OpenAI embedding 实现（text-embedding-3-small）。
 */
class OpenAiEmbedder implements Embedder {
  readonly name = 'openai';

  private get baseUrl() {
    return process.env.AI_BASE_URL ?? 'https://api.openai.com/v1';
  }
  private get apiKey() {
    return process.env.AI_API_KEY;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('AI_API_KEY not configured');
    }
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.AI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
        input: text,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Embedding failed (${res.status}): ${err}`);
    }
    const data = await res.json();
    return data.data?.[0]?.embedding ?? [];
  }
}

function resolveEmbedder(): Embedder {
  if (process.env.AI_API_KEY) {
    return new OpenAiEmbedder();
  }
  return new LocalHashEmbedder();
}

let cached: Embedder | null = null;
export function getEmbedder(): Embedder {
  if (!cached) cached = resolveEmbedder();
  return cached;
}

/**
 * 余弦相似度。
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const dim = Math.max(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < dim; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
