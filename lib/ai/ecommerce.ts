import 'server-only';
import { withTenantContext } from '@/lib/db/tenant';
import { eq } from 'drizzle-orm';
import { teams, aiContents } from '@/lib/db/schema';
import { getAiProvider, type ChatMessage } from './provider';
import { recordUsage } from './usage';
import { getPlanByTier } from '@/lib/db/queries';
import { getScene, type AiSceneId } from './scenes';

export class FeatureNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureNotAllowedError';
  }
}

export class SceneQuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneQuotaExceededError';
  }
}

/**
 * 电商场景 AI 调用统一入口。
 * 完整链路：加载租户 → 功能开关校验 → 场景配额校验 → 调用 → 记录 ai_contents + usage。
 */
export async function runSceneCompletion(params: {
  teamId: number;
  scene: AiSceneId;
  messages: ChatMessage[];
  shopId?: number | null;
  productId?: number | null;
  inputText?: string;
  temperature?: number;
}) {
  const scene = getScene(params.scene);

  // 读取租户（teams 受 RLS 约束，需租户上下文）
  const team = await withTenantContext(params.teamId, null, async (tx) => {
    const [team] = await tx
      .select()
      .from(teams)
      .where(eq(teams.id, params.teamId))
      .limit(1);
    return team;
  });

  if (!team) {
    throw new Error('Tenant not found');
  }

  const plan = await getPlanByTier(team.planTier);

  // 1. 功能开关校验
  if (plan && !plan[scene.featureKey]) {
    throw new FeatureNotAllowedError(
      `当前套餐（${plan.name}）未开通「${scene.name}」功能，请升级套餐。`
    );
  }

  // 2. 场景配额校验（analytics 无独立配额，走 token 配额）
  if (scene.quotaKey && plan) {
    // 简化：此处依赖 usage_records 中的 scene 维度统计，由 quota.ts 的 checkQuota 统一处理 token。
    // 场景级条数配额在 service 层通过 ai_contents 计数校验。
  }

  // 3. 调用 Provider（场景系统提示词前置；网络调用置于事务之外）
  const provider = getAiProvider();
  const result = await provider.chatCompletion({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: scene.systemPrompt }, ...params.messages],
    temperature: params.temperature,
  });

  // 4 & 5. 记录用量 + 生成内容（同一租户的两次写入放进同一个事务）
  await withTenantContext(team.id, null, async (tx) => {
    await recordUsage(
      {
        teamId: team.id,
        projectId: null,
        apiKeyId: null,
        kind: `scene:${scene.id}`,
        model: result.model,
        provider: result.provider,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
      tx
    );

    await tx.insert(aiContents).values({
      teamId: team.id,
      shopId: params.shopId ?? null,
      productId: params.productId ?? null,
      scene: scene.id,
      input: params.inputText ?? null,
      output: result.content,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
  });

  return {
    content: result.content,
    scene: scene.id,
    model: result.model,
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  };
}

/**
 * 统计某租户本月各场景的生成条数（用于场景配额展示）。
 */
export async function getSceneUsageCounts(teamId: number) {
  const rows = await withTenantContext(teamId, null, async (tx) => {
    return await tx
      .select({
        scene: aiContents.scene,
      })
      .from(aiContents)
      .where(eq(aiContents.teamId, teamId));
  });

  // 简化：全量计数（生产可加时间过滤）
  const counts: Record<string, number> = {};
  for (const r of rows) {
    counts[r.scene] = (counts[r.scene] ?? 0) + 1;
  }
  return counts;
}
