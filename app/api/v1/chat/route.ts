import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateApiKey } from '@/lib/ai/apikey';
import { runAiCompletion, QuotaExceededError } from '@/lib/ai/service';
import { rateLimit } from '@/lib/security/rate-limit';

const chatSchema = z.object({
  model: z.string().max(100).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().max(10000),
      })
    )
    .min(1)
    .max(50),
  temperature: z.number().min(0).max(2).optional(),
});

/**
 * 对外开放的 AI API，使用 Bearer API Key 鉴权。
 * 客户端：Authorization: Bearer sk-saas_xxx
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return NextResponse.json(
      { error: 'Missing API key' },
      { status: 401 }
    );
  }

  const apiKey = await validateApiKey(token);
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Invalid or expired API key' },
      { status: 401 }
    );
  }

  // 速率限制：每 API Key 每分钟 30 次
  const rl = await rateLimit(`apikey:${apiKey.id}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  let body: z.infer<typeof chatSchema>;
  try {
    body = chatSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  try {
    const result = await runAiCompletion({
      teamId: apiKey.teamId,
      apiKeyId: apiKey.id,
      kind: 'api',
      model: body.model,
      messages: body.messages,
      temperature: body.temperature,
    });

    return NextResponse.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      model: result.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: result.content },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: result.usage.inputTokens,
        completion_tokens: result.usage.outputTokens,
        total_tokens: result.usage.totalTokens,
      },
    });
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return NextResponse.json({ error: e.message }, { status: 402 });
    }
    console.error('AI api error:', e);
    return NextResponse.json(
      { error: 'AI service error' },
      { status: 500 }
    );
  }
}
