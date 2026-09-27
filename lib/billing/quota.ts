import { getTeamQuota, getTeamUsage } from '@/lib/db/queries';
import { Team } from '@/lib/db/schema';

export type QuotaCheckResult = {
  allowed: boolean;
  reason?: string;
  quota: Awaited<ReturnType<typeof getTeamQuota>>;
  usage: Awaited<ReturnType<typeof getTeamUsage>>;
};

/**
 * 校验租户是否还有配额余量，用于 AI 调用前拦截。
 * - 检查本月 token 是否超出
 * - 检查今日 API 调用次数是否超出
 */
export async function checkQuota(team: Team): Promise<QuotaCheckResult> {
  const quota = await getTeamQuota(team);
  const usage = await getTeamUsage(team.id);

  if (
    quota.quotaTokenMonthly > 0 &&
    usage.monthlyTokens >= quota.quotaTokenMonthly
  ) {
    return {
      allowed: false,
      reason: '本月 AI Token 配额已用完，请升级套餐或购买增量。',
      quota,
      usage,
    };
  }

  if (
    quota.quotaApiCallsDaily > 0 &&
    usage.dailyApiCalls >= quota.quotaApiCallsDaily
  ) {
    return {
      allowed: false,
      reason: '今日 API 调用次数已达上限，请升级套餐或次日重试。',
      quota,
      usage,
    };
  }

  return { allowed: true, quota, usage };
}

/**
 * 校验项目数是否超出配额（创建项目前调用）。
 */
export async function checkProjectQuota(
  team: Team,
  currentProjectCount: number
): Promise<{ allowed: boolean; reason?: string }> {
  const quota = await getTeamQuota(team);
  if (quota.quotaProjects > 0 && currentProjectCount >= quota.quotaProjects) {
    return {
      allowed: false,
      reason: `已达到 AI 项目数上限（${quota.quotaProjects} 个）。`,
    };
  }
  return { allowed: true };
}

/**
 * 校验成员数是否超出配额（邀请成员前调用）。
 */
export async function checkMemberQuota(
  team: Team,
  currentMemberCount: number
): Promise<{ allowed: boolean; reason?: string }> {
  const quota = await getTeamQuota(team);
  if (quota.quotaMembers > 0 && currentMemberCount >= quota.quotaMembers) {
    return {
      allowed: false,
      reason: `已达到团队成员数上限（${quota.quotaMembers} 人）。`,
    };
  }
  return { allowed: true };
}

/**
 * 校验门店数是否超出配额（创建门店前调用）。
 */
export async function checkShopQuota(
  team: Team,
  currentShopCount: number
): Promise<{ allowed: boolean; reason?: string }> {
  const quota = await getTeamQuota(team);
  if (quota.quotaShops > 0 && currentShopCount >= quota.quotaShops) {
    return {
      allowed: false,
      reason: `已达到门店数上限（${quota.quotaShops} 家）。`,
    };
  }
  return { allowed: true };
}

/**
 * 校验商品数是否超出配额（创建/导入商品前调用）。
 * allowAdditional 表示允许超出的额外条数（用于批量导入时预估）。
 */
export async function checkProductQuota(
  team: Team,
  currentProductCount: number,
  additional = 0
): Promise<{ allowed: boolean; reason?: string }> {
  const quota = await getTeamQuota(team);
  if (
    quota.quotaProducts > 0 &&
    currentProductCount + additional >= quota.quotaProducts
  ) {
    return {
      allowed: false,
      reason: `已达到商品数上限（${quota.quotaProducts} 个）。`,
    };
  }
  return { allowed: true };
}
