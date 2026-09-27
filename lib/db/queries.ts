import { desc, and, eq, isNull, sql, gte, count } from 'drizzle-orm';
import { db } from './drizzle';
import {
  activityLogs,
  teamMembers,
  teams,
  users,
  plans,
  aiProjects,
  apiKeys,
  usageRecords,
  shops,
  products,
  orders,
  aiContents
} from './schema';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/session';

export async function getUser() {
  const sessionCookie = (await cookies()).get('session');
  if (!sessionCookie || !sessionCookie.value) {
    return null;
  }

  const sessionData = await verifyToken(sessionCookie.value);
  if (
    !sessionData ||
    !sessionData.user ||
    typeof sessionData.user.id !== 'number'
  ) {
    return null;
  }

  if (new Date(sessionData.expires) < new Date()) {
    return null;
  }

  const user = await db
    .select()
    .from(users)
    .where(and(eq(users.id, sessionData.user.id), isNull(users.deletedAt)))
    .limit(1);

  if (user.length === 0) {
    return null;
  }

  return user[0];
}

export async function getTeamByStripeCustomerId(customerId: string) {
  const result = await db
    .select()
    .from(teams)
    .where(eq(teams.stripeCustomerId, customerId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function updateTeamSubscription(
  teamId: number,
  subscriptionData: {
    stripeSubscriptionId: string | null;
    stripeProductId: string | null;
    planName: string | null;
    subscriptionStatus: string;
    planTier?: string;
  }
) {
  await db
    .update(teams)
    .set({
      ...subscriptionData,
      updatedAt: new Date()
    } as any)
    .where(eq(teams.id, teamId));
}

export async function getUserWithTeam(userId: number) {
  const result = await db
    .select({
      user: users,
      teamId: teamMembers.teamId
    })
    .from(users)
    .leftJoin(teamMembers, eq(users.id, teamMembers.userId))
    .where(eq(users.id, userId))
    .limit(1);

  return result[0];
}

export async function getActivityLogs() {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  return await db
    .select({
      id: activityLogs.id,
      action: activityLogs.action,
      timestamp: activityLogs.timestamp,
      ipAddress: activityLogs.ipAddress,
      userName: users.name
    })
    .from(activityLogs)
    .leftJoin(users, eq(activityLogs.userId, users.id))
    .where(eq(activityLogs.userId, user.id))
    .orderBy(desc(activityLogs.timestamp))
    .limit(10);
}

export async function getTeamForUser() {
  const user = await getUser();
  if (!user) {
    return null;
  }

  const result = await db.query.teamMembers.findFirst({
    where: eq(teamMembers.userId, user.id),
    with: {
      team: {
        with: {
          teamMembers: {
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                  email: true
                }
              }
            }
          }
        }
      }
    }
  });

  return result?.team || null;
}

/**
 * 获取当前用户在租户内的角色。
 */
export async function getMembershipForUser(
  userId: number
): Promise<'owner' | 'admin' | 'member' | null> {
  const result = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
    .limit(1);

  return result[0]?.role ?? null;
}

// ─────────────────────────────────────────────
// 订阅计划与配额
// ─────────────────────────────────────────────

export async function getPlanByTier(tier: string) {
  const result = await db
    .select()
    .from(plans)
    .where(eq(plans.tier, tier as any))
    .limit(1);
  return result[0] ?? null;
}

export async function getAllPlans() {
  return await db.select().from(plans).orderBy(plans.priceMonthlyCents);
}

/**
 * 计算租户的有效配额：custom_quota 覆盖 > plan 默认值。
 * 包含 AI token 配额与电商场景配额。
 */
export async function getTeamQuota(team: { planTier: string; customQuota: any }) {
  const plan = await getPlanByTier(team.planTier);
  const base = {
    quotaTokenMonthly: plan?.quotaTokenMonthly ?? 0,
    quotaProjects: plan?.quotaProjects ?? 0,
    quotaMembers: plan?.quotaMembers ?? 0,
    quotaApiCallsDaily: plan?.quotaApiCallsDaily ?? 0,
    quotaShops: plan?.quotaShops ?? 1,
    quotaProducts: plan?.quotaProducts ?? 0,
    quotaCopiesMonthly: plan?.quotaCopiesMonthly ?? 0,
    quotaCampaignsMonthly: plan?.quotaCampaignsMonthly ?? 0,
    quotaServiceSessionsMonthly: plan?.quotaServiceSessionsMonthly ?? 0,
  };
  const override = (team.customQuota ?? {}) as Record<string, number>;
  return {
    ...base,
    ...override,
  };
}

/**
 * 获取租户当前套餐的能力（功能开关 + 配额），用于前端 gating 与升级引导。
 */
export async function getTeamPlanCapabilities(team: { planTier: string; customQuota: any }) {
  const plan = await getPlanByTier(team.planTier);
  const quota = await getTeamQuota(team);
  return {
    planName: plan?.name ?? 'Free',
    planTier: team.planTier,
    features: {
      copywriting: plan?.featureCopywriting ?? false,
      marketing: plan?.featureMarketing ?? false,
      customerService: plan?.featureCustomerService ?? false,
      analytics: plan?.featureAnalytics ?? false,
    },
    quota,
  };
}

/**
 * 统计租户本月已用 token 与今日 API 调用次数。
 */
export async function getTeamUsage(teamId: number) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [monthly] = await db
    .select({
      tokens: sql<number>`COALESCE(SUM(input_tokens + output_tokens), 0)`,
    })
    .from(usageRecords)
    .where(
      and(eq(usageRecords.teamId, teamId), gte(usageRecords.createdAt, monthStart))
    );

  const [daily] = await db
    .select({ calls: sql<number>`COALESCE(COUNT(*), 0)` })
    .from(usageRecords)
    .where(
      and(eq(usageRecords.teamId, teamId), gte(usageRecords.createdAt, dayStart))
    );

  return {
    monthlyTokens: Number(monthly?.tokens ?? 0),
    dailyApiCalls: Number(daily?.calls ?? 0),
  };
}

// ─────────────────────────────────────────────
// AI 资源（项目 / API Key / 用量）
// ─────────────────────────────────────────────

export async function getAiProjectsForTeam(teamId: number) {
  return await db
    .select()
    .from(aiProjects)
    .where(and(eq(aiProjects.teamId, teamId), isNull(aiProjects.deletedAt)))
    .orderBy(desc(aiProjects.createdAt));
}

export async function getAiProjectById(projectId: number, teamId: number) {
  const result = await db
    .select()
    .from(aiProjects)
    .where(
      and(
        eq(aiProjects.id, projectId),
        eq(aiProjects.teamId, teamId),
        isNull(aiProjects.deletedAt)
      )
    )
    .limit(1);
  return result[0] ?? null;
}

export async function getApiKeysForTeam(teamId: number) {
  return await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      isActive: apiKeys.isActive,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.teamId, teamId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function getApiKeyByHash(keyHash: string) {
  const result = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)))
    .limit(1);
  return result[0] ?? null;
}

export async function getRecentUsageForTeam(teamId: number, limit = 20) {
  return await db
    .select()
    .from(usageRecords)
    .where(eq(usageRecords.teamId, teamId))
    .orderBy(desc(usageRecords.createdAt))
    .limit(limit);
}

// ─────────────────────────────────────────────
// 平台管理后台
// ─────────────────────────────────────────────

export async function getAllTeamsWithStats() {
  const allTeams = await db.select().from(teams).orderBy(desc(teams.createdAt));
  const memberCounts = await db
    .select({ teamId: teamMembers.teamId, count: sql<number>`COUNT(*)` })
    .from(teamMembers)
    .groupBy(teamMembers.teamId);

  const countMap = new Map(memberCounts.map((r) => [r.teamId, Number(r.count)]));

  return allTeams.map((team) => ({
    ...team,
    memberCount: countMap.get(team.id) ?? 0,
  }));
}

export async function getAllUsersWithStats() {
  return await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      platformRole: users.platformRole,
      createdAt: users.createdAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(desc(users.createdAt));
}

// ─────────────────────────────────────────────
// 商家实体（门店 / 商品 / 订单 / AI 内容）
// ─────────────────────────────────────────────

export async function getShopsForTeam(teamId: number) {
  return await db
    .select()
    .from(shops)
    .where(and(eq(shops.teamId, teamId), isNull(shops.deletedAt)))
    .orderBy(desc(shops.createdAt));
}

export async function getShopById(shopId: number, teamId: number) {
  const result = await db
    .select()
    .from(shops)
    .where(
      and(
        eq(shops.id, shopId),
        eq(shops.teamId, teamId),
        isNull(shops.deletedAt)
      )
    )
    .limit(1);
  return result[0] ?? null;
}

export async function getProductsForTeam(teamId: number, shopId?: number) {
  const conditions = [
    eq(products.teamId, teamId),
    isNull(products.deletedAt),
  ];
  if (shopId) {
    conditions.push(eq(products.shopId, shopId));
  }
  return await db
    .select()
    .from(products)
    .where(and(...conditions))
    .orderBy(desc(products.createdAt));
}

export async function getProductById(productId: number, teamId: number) {
  const result = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.id, productId),
        eq(products.teamId, teamId),
        isNull(products.deletedAt)
      )
    )
    .limit(1);
  return result[0] ?? null;
}

export async function getOrdersForTeam(teamId: number, shopId?: number) {
  const conditions = [eq(orders.teamId, teamId)];
  if (shopId) {
    conditions.push(eq(orders.shopId, shopId));
  }
  return await db
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.orderedAt))
    .limit(200);
}

export async function getAiContentsForTeam(teamId: number, scene?: string) {
  const conditions = [eq(aiContents.teamId, teamId)];
  if (scene) {
    conditions.push(eq(aiContents.scene, scene));
  }
  return await db
    .select()
    .from(aiContents)
    .where(and(...conditions))
    .orderBy(desc(aiContents.createdAt))
    .limit(50);
}

/**
 * 统计团队电商数据概览（用于数据分析场景）。
 */
export async function getEcommerceStats(teamId: number) {
  const [shopCount] = await db
    .select({ value: count() })
    .from(shops)
    .where(and(eq(shops.teamId, teamId), isNull(shops.deletedAt)));

  const [productCount] = await db
    .select({ value: count() })
    .from(products)
    .where(and(eq(products.teamId, teamId), isNull(products.deletedAt)));

  const [orderCount] = await db
    .select({ value: count() })
    .from(orders)
    .where(eq(orders.teamId, teamId));

  const [revenue] = await db
    .select({ value: sql<number>`COALESCE(SUM(amount), 0)` })
    .from(orders)
    .where(eq(orders.teamId, teamId));

  return {
    shopCount: Number(shopCount?.value ?? 0),
    productCount: Number(productCount?.value ?? 0),
    orderCount: Number(orderCount?.value ?? 0),
    totalRevenue: Number(revenue?.value ?? 0),
  };
}

/**
 * 订单按状态聚合（用于图表）。
 */
export async function getOrderStatusBreakdown(teamId: number) {
  const rows = await db
    .select({
      status: orders.status,
      value: count(),
    })
    .from(orders)
    .where(eq(orders.teamId, teamId))
    .groupBy(orders.status);

  return rows.map((r) => ({ status: r.status, count: Number(r.value) }));
}

/**
 * 近 N 天订单量趋势（用于折线图）。
 */
export async function getOrderTrend(teamId: number, days = 14) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      day: sql<string>`to_char(ordered_at, 'MM-DD')`,
      orderCount: count(),
      revenue: sql<number>`COALESCE(SUM(amount), 0)`,
    })
    .from(orders)
    .where(and(eq(orders.teamId, teamId), gte(orders.orderedAt, since)))
    .groupBy(sql`to_char(ordered_at, 'MM-DD')`)
    .orderBy(sql`to_char(ordered_at, 'MM-DD')`);

  return rows.map((r) => ({
    day: r.day,
    orderCount: Number(r.orderCount),
    revenue: Number(r.revenue),
  }));
}

/**
 * 商品销量 TOP N（用于柱状图）。
 */
export async function getTopProducts(teamId: number, limit = 10) {
  const rows = await db
    .select({
      productId: orders.productId,
      title: products.title,
      orderCount: count(),
      revenue: sql<number>`COALESCE(SUM(${orders.amount}), 0)`,
    })
    .from(orders)
    .leftJoin(products, eq(orders.productId, products.id))
    .where(eq(orders.teamId, teamId))
    .groupBy(orders.productId, products.title)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  return rows.map((r) => ({
    title: r.title ?? `商品 #${r.productId}`,
    orderCount: Number(r.orderCount),
    revenue: Number(r.revenue),
  }));
}

/**
 * 各商品品类数量分布（用于饼图）。
 */
export async function getCategoryDistribution(teamId: number) {
  const rows = await db
    .select({
      category: products.category,
      value: count(),
    })
    .from(products)
    .where(and(eq(products.teamId, teamId), isNull(products.deletedAt)))
    .groupBy(products.category);

  return rows.map((r) => ({
    category: r.category ?? '未分类',
    count: Number(r.value),
  }));
}
