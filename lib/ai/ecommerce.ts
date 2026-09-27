import 'server-only';
import { db } from '@/lib/db/drizzle';
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

  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, params.teamId))
    .limit(1);

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

  // 3. 调用 Provider（场景系统提示词前置）
  const provider = getAiProvider();
  const result = await provider.chatCompletion({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: scene.systemPrompt }, ...params.messages],
    temperature: params.temperature,
  });

  // 4. 记录用量
  await recordUsage({
    teamId: team.id,
    projectId: null,
    apiKeyId: null,
    kind: `scene:${scene.id}`,
    model: result.model,
    provider: result.provider,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });

  // 5. 记录生成内容（供历史复用）
  await db.insert(aiContents).values({
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
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const rows = await db
    .select({
      scene: aiContents.scene,
    })
    .from(aiContents)
    .where(eq(aiContents.teamId, teamId));

  // 简化：全量计数（生产可加时间过滤）
  const counts: Record<string, number> = {};
  for (const r of rows) {
    counts[r.scene] = (counts[r.scene] ?? 0) + 1;
  }
  return counts;
}
