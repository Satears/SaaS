import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantApi } from '@/lib/auth/rbac';
import { getAiProvider, type ChatMessage } from '@/lib/ai/provider';
import { recordUsage } from '@/lib/ai/usage';
import {
  searchKnowledge,
  knowledgeToContext,
  createSession,
  getSession,
  getSessionMessages,
  appendMessage,
  listSessions,
} from '@/lib/ai/knowledge';
import { getScene } from '@/lib/ai/scenes';
import { runSceneCompletion } from '@/lib/ai/ecommerce';

const askSchema = z.object({
  sessionId: z.number().int().positive().optional().nullable(),
  shopId: z.number().int().positive().optional().nullable(),
  message: z.string().min(1).max(2000),
  language: z.string().max(10).optional(),
});

// GET: 列出会话
export async function GET() {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sessions = await listSessions(ctx.team.id);
  return NextResponse.json(sessions);
}

// POST: 发送客服消息（多轮对话 + 知识库 RAG）
export async function POST(request: NextRequest) {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = askSchema.parse(await request.json());

  // 1. 获取或创建会话
  let sessionId = body.sessionId;
  if (!sessionId) {
    const session = await createSession({
      teamId: ctx.team.id,
      shopId: body.shopId ?? null,
      userId: ctx.user.id,
      language: body.language ?? 'zh',
    });
    sessionId = session.id;
  } else {
    const session = await getSession(sessionId, ctx.team.id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
  }

  // 2. 记录用户消息
  await appendMessage({
    sessionId,
    role: 'user',
    content: body.message,
  });

  // 3. 知识库 RAG 检索
  const hits = await searchKnowledge(ctx.team.id, body.message, 3, body.shopId ?? undefined);
  const knowledgeCtx = knowledgeToContext(hits);

  // 4. 构建多轮上下文（最近 10 条历史 + 知识库片段）
  const history = await getSessionMessages(sessionId, 10);
  const scene = getScene('customer_service');

  const messages: ChatMessage[] = [];
  if (knowledgeCtx) {
    messages.push({
      role: 'system',
      content: `${scene.systemPrompt}\n\n以下是相关客服知识库内容，请优先参考：\n${knowledgeCtx}`,
    });
  }
  for (const m of history) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role as 'user' | 'assistant', content: m.content });
    }
  }

  // 5. 调用 Provider（带知识库上下文的客服场景）
  const provider = getAiProvider();
  const result = await provider.chatCompletion({
    model: 'gpt-4o-mini',
    messages: messages.length > 0 ? messages : [{ role: 'system', content: scene.systemPrompt }, { role: 'user', content: body.message }],
    temperature: 0.5,
  });

  // 6. 记录助手消息
  await appendMessage({
    sessionId,
    role: 'assistant',
    content: result.content,
    tokens: result.outputTokens,
  });

  // 7. 记录用量
  await recordUsage({
    teamId: ctx.team.id,
    projectId: null,
    apiKeyId: null,
    kind: 'scene:customer_service',
    model: result.model,
    provider: result.provider,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });

  return NextResponse.json({
    sessionId,
    content: result.content,
    knowledgeHits: hits.map((h) => ({ id: h.id, question: h.question })),
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  });
}
