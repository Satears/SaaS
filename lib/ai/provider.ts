import 'server-only';

/**
 * AI Provider 抽象层。
 * 通过统一接口隔离不同模型服务商（OpenAI、Anthropic 等），
 * 便于后续扩展与切换，同时为用量计量提供统一出口。
 */

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatCompletionResult = {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  provider: string;
};

export interface AiProvider {
  readonly name: string;
  chatCompletion(params: {
    model: string;
    messages: ChatMessage[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<ChatCompletionResult>;
}

/**
 * 内置 Provider：当前通过环境变量配置的 OpenAI 兼容端点。
 * 若未配置 API Key，则返回一个 mock provider 用于本地开发演示。
 */
class OpenAiCompatibleProvider implements AiProvider {
  readonly name = 'openai-compatible';

  private get baseUrl() {
    return process.env.AI_BASE_URL ?? 'https://api.openai.com/v1';
  }

  private get apiKey() {
    return process.env.AI_API_KEY;
  }

  async chatCompletion(params: {
    model: string;
    messages: ChatMessage[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<ChatCompletionResult> {
    if (!this.apiKey) {
      throw new Error('AI_API_KEY is not configured');
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        max_tokens: params.maxTokens,
        temperature: params.temperature ?? 0.7,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI provider error (${res.status}): ${text}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;

    return {
      content,
      model: data.model ?? params.model,
      inputTokens,
      outputTokens,
      provider: this.name,
    };
  }
}

/**
 * Mock Provider：无 AI_API_KEY 时的本地演示回退，便于离线开发。
 */
class MockProvider implements AiProvider {
  readonly name = 'mock';

  async chatCompletion(params: {
    model: string;
    messages: ChatMessage[];
  }): Promise<ChatCompletionResult> {
    const lastUser = [...params.messages].reverse().find((m) => m.role === 'user');
    const inputTokens = params.messages
      .reduce((acc, m) => acc + m.content.length, 0) / 4;
    const content = `[演示回复 · ${params.model}] 收到你的消息：${
      lastUser?.content?.slice(0, 80) ?? ''
    }…（未配置 AI_API_KEY，这是本地 mock 输出）`;
    return {
      content,
      model: params.model,
      inputTokens: Math.max(1, Math.round(inputTokens)),
      outputTokens: Math.max(1, Math.round(content.length / 4)),
      provider: this.name,
    };
  }
}

function resolveProvider(): AiProvider {
  if (process.env.AI_API_KEY) {
    return new OpenAiCompatibleProvider();
  }
  return new MockProvider();
}

let cached: AiProvider | null = null;
export function getAiProvider(): AiProvider {
  if (!cached) {
    cached = resolveProvider();
  }
  return cached;
}

/**
 * 估算 token 成本（分）。可按 provider 定价表扩展。
 */
export function estimateCostCents(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  // 简化定价：按每 1k token 估算（可替换为真实价目表）
  const rate = model.includes('gpt-4') ? { in: 0.03, out: 0.06 } : { in: 0.0015, out: 0.006 };
  return Math.round(
    (inputTokens / 1000) * rate.in + (outputTokens / 1000) * rate.out
  );
}
