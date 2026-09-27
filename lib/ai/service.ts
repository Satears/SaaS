import 'server-only';
import { withTenantContext } from '@/lib/db/tenant';
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
 *
 * 说明：租户/项目读取与配额校验放在同一个 withTenantContext 事务里；
 * Provider 是外部网络调用，刻意放在事务之外（避免长期占用连接池连接），
 * 用量写入再单独成事务。
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
  const { team, model, messages, quotaCheck } = await withTenantContext(
    params.teamId,
    null,
    async (tx) => {
      const [team] = await tx
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
        const [project] = await tx
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
      const quotaCheck = await checkQuota(team, tx);
      if (!quotaCheck.allowed) {
        throw new QuotaExceededError(quotaCheck.reason ?? 'Quota exceeded');
      }

      return { team, model, messages, quotaCheck };
    }
  );

  // 调用 Provider（网络调用，置于事务之外）
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
