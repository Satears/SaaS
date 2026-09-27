import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantApi } from '@/lib/auth/rbac';
import { runAiCompletion, QuotaExceededError } from '@/lib/ai/service';
import { rateLimit } from '@/lib/security/rate-limit';

const chatSchema = z.object({
  projectId: z.number().int().positive().optional().nullable(),
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

export async function POST(request: NextRequest) {
  // 会话鉴权 + 租户上下文
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 速率限制：每租户每分钟 20 次
  const rl = rateLimit(`ai:team:${ctx.team.id}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please slow down.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  let body: z.infer<typeof chatSchema>;
  try {
    body = chatSchema.parse(await request.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  try {
    const result = await runAiCompletion({
      teamId: ctx.team.id,
      projectId: body.projectId ?? null,
      kind: 'chat',
      messages: body.messages,
      temperature: body.temperature,
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return NextResponse.json({ error: e.message }, { status: 402 });
    }
    console.error('AI chat error:', e);
    return NextResponse.json(
      { error: 'AI service error' },
      { status: 500 }
    );
  }
}
