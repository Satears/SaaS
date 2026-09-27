import 'server-only';
import { db } from '@/lib/db/drizzle';
import { eq } from 'drizzle-orm';
import { teams, aiProjects } from '@/lib/db/schema';
import { getAiProvider, type ChatMessage } from './provider';
import { recordUsage } from './usage';
import { checkQuota } from '@/lib/billing/quota';

/**
 * 执行一次 AI 聊天/补全调用，完整编排：
 * 1. 加载租户与项目
 * 2. 校验配额（token / 调用次数）
 * 3. 调用 AI Provider
 * 4. 记录用量
 * 5. 返回结果 + 用量信息
 */
export async function runAiCompletion(params: {
  teamId: number;
  projectId?: number | null;
  apiKeyId?: number | null;
  kind: string;
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
}) {
  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, params.teamId))
    .limit(1);

  if (!team) {
    throw new Error('Tenant not found');
  }

  // 项目级模型与 system prompt
  let model = params.model ?? 'gpt-4o-mini';
  let messages = params.messages;

  if (params.projectId) {
    const [project] = await db
      .select()
      .from(aiProjects)
      .where(eq(aiProjects.id, params.projectId))
      .limit(1);
    if (project) {
      model = project.model;
      if (project.systemPrompt) {
        messages = [
          { role: 'system', content: project.systemPrompt },
          ...messages,
        ];
      }
    }
  }

  // 配额校验
  const quotaCheck = await checkQuota(team);
  if (!quotaCheck.allowed) {
    throw new QuotaExceededError(quotaCheck.reason ?? 'Quota exceeded');
  }

  // 调用 Provider
  const provider = getAiProvider();
  const result = await provider.chatCompletion({
    model,
    messages,
    temperature: params.temperature,
  });

  // 记录用量
  await recordUsage({
    teamId: team.id,
    projectId: params.projectId ?? null,
    apiKeyId: params.apiKeyId ?? null,
    kind: params.kind,
    model: result.model,
    provider: result.provider,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });

  return {
    content: result.content,
    model: result.model,
    provider: result.provider,
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.inputTokens + result.outputTokens,
    },
    quota: quotaCheck.quota,
    usageStats: quotaCheck.usage,
  };
}

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}
