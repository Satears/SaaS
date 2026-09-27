import { desc, asc, and, eq, isNull, sql, gte, count, type InferSelectModel } from 'drizzle-orm';
import { db } from './drizzle';
import { withTenantContext, type TenantTx } from './tenant';
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
  aiContents,
  type User
} from './schema';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/session';

/**
 * RLS 事务辅助：若调用方已持有事务句柄（tx）则直接复用，避免嵌套 begin
 * （postgres-js 不支持嵌套事务）；否则开启一个新的租户上下文事务。
 */
function runWithContext<T>(
  teamId: number | null,
  userId: number | null,
  tx: TenantTx | undefined,
  fn: (tx: TenantTx) => Promise<T>
): Promise<T> {
  return tx ? fn(tx) : withTenantContext(teamId, userId, fn);
}

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

  // users 为全局表，不受 RLS 约束，无需租户上下文。
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

/**
 * 可安全下发给客户端的用户信息（去除 passwordHash 等凭证字段）。
 * 用于 /api/user 与根布局的 SWR fallback —— 这两处都会把数据序列化进
 * 客户端响应（RSC 载荷 / HTML），绝不能包含密码哈希。
 */
export type PublicUser = Omit<User, 'passwordHash'>;

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

/**
 * 按 Stripe customerId 定位 team。
 *
 * 跨租户查询：Stripe webhook 没有用户会话，无法提供 app.team_id / app.user_id。
 * 因此先走特权路径取 id（SECURITY DEFINER，只返回 id，见 0010_privileged_functions.sql），
 * 拿到 id 后立即回到正常租户上下文读取整行，避免把整行读权限铺开。
 */
export async function getTeamByStripeCustomerId(customerId: string) {
  const rows = (await db.execute(
    sql`SELECT app_find_team_id_by_stripe_customer(${customerId}) AS team_id`
  )) as unknown as { team_id: number | null }[];

  const teamId = rows[0]?.team_id ?? null;
  if (!teamId) return null;

  const [team] = await withTenantContext(teamId, null, (tx) =>
    tx.select().from(teams).where(eq(teams.id, teamId)).limit(1)
  );
  return team ?? null;
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
  await withTenantContext(teamId, null, async (tx) => {
    await tx
      .update(teams)
      .set({
        ...subscriptionData,
        updatedAt: new Date()
      } as any)
      .where(eq(teams.id, teamId));
  });
}

export async function getUserWithTeam(userId: number, tx?: TenantTx) {
  return runWithContext(null, userId, tx, async (t) => {
    const result = await t
      .select({
        user: users,
        teamId: teamMembers.teamId
      })
      .from(users)
      .leftJoin(teamMembers, eq(users.id, teamMembers.userId))
      .where(eq(users.id, userId))
      // 多租户下同一用户可属于多个团队；固定排序保证结果可预期（取最早加入的团队）
      .orderBy(asc(teamMembers.id))
      .limit(1);

    return result[0];
  });
}

export async function getActivityLogs() {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  // activity_logs 受 RLS 约束（策略要求 app.team_id）。当前用户 id 已知，
  // 先借 app.user_id 解析出所属团队，再以该 team 上下文读取日志。
  const userWithTeam = await getUserWithTeam(user.id);
  const teamId = userWithTeam?.teamId ?? null;

  return await withTenantContext(teamId, user.id, async (tx) => {
    return await tx
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
  });
}

/**
 * 获取当前用户所属团队。
 * 未指定 teamId 时取最早加入的团队（多租户下保证结果确定性，避免随机落到某个团队）。
 */
export async function getTeamForUser(teamId?: number) {
  const user = await getUser();
  if (!user) {
    return null;
  }

  return await withTenantContext(teamId ?? null, user.id, async (tx) => {
    const result = await tx.query.teamMembers.findFirst({
      where:
        teamId !== undefined
          ? and(
              eq(teamMembers.userId, user.id),
              eq(teamMembers.teamId, teamId)
            )
          : eq(teamMembers.userId, user.id),
      orderBy: [asc(teamMembers.id)],
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
  });
}

/**
 * 获取当前用户在租户内的角色。
 */
export async function getMembershipForUser(
  userId: number,
  teamId?: number,
  tx?: TenantTx
): Promise<'owner' | 'admin' | 'member' | null> {
  // 必须按 teamId 限定：否则用户在 A 团队是 owner、在 B 团队是 member 时，
  // 角色校验可能取到其它团队的角色，造成越权。
  const conditions = [eq(teamMembers.userId, userId)];
  if (teamId !== undefined) {
    conditions.push(eq(teamMembers.teamId, teamId));
  }

  return runWithContext(teamId ?? null, userId, tx, async (t) => {
    const result = await t
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(...conditions))
      .orderBy(asc(teamMembers.id))
      .limit(1);

    return result[0]?.role ?? null;
  });
}

// ─────────────────────────────────────────────
// 订阅计划与配额
// ─────────────────────────────────────────────

// plans 为全局表，不受 RLS 约束。
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
 * 仅读取全局表 plans，无需租户上下文。
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
 * 仅读取全局表 plans，无需租户上下文。
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
export async function getTeamUsage(teamId: number, tx?: TenantTx) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return runWithContext(teamId, null, tx, async (t) => {
    const [monthly] = await t
      .select({
        tokens: sql<number>`COALESCE(SUM(input_tokens + output_tokens), 0)`,
      })
      .from(usageRecords)
      .where(
        and(eq(usageRecords.teamId, teamId), gte(usageRecords.createdAt, monthStart))
      );

    const [daily] = await t
      .select({ calls: sql<number>`COALESCE(COUNT(*), 0)` })
      .from(usageRecords)
      .where(
        and(eq(usageRecords.teamId, teamId), gte(usageRecords.createdAt, dayStart))
      );

    return {
      monthlyTokens: Number(monthly?.tokens ?? 0),
      dailyApiCalls: Number(daily?.calls ?? 0),
    };
  });
}

// ─────────────────────────────────────────────
// AI 资源（项目 / API Key / 用量）
// ─────────────────────────────────────────────

export async function getAiProjectsForTeam(teamId: number, tx?: TenantTx) {
  return runWithContext(teamId, null, tx, async (t) => {
    return await t
      .select()
      .from(aiProjects)
      .where(and(eq(aiProjects.teamId, teamId), isNull(aiProjects.deletedAt)))
      .orderBy(desc(aiProjects.createdAt));
  });
}

export async function getAiProjectById(
  projectId: number,
  teamId: number,
  tx?: TenantTx
) {
  return runWithContext(teamId, null, tx, async (t) => {
    const result = await t
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
  });
}

export async function getApiKeysForTeam(teamId: number) {
  return await withTenantContext(teamId, null, async (tx) => {
    return await tx
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
  });
}

/**
 * 按 keyHash 查找 API Key。
 *
 * ⚠️ 认证路径：调用方（API Key 鉴权）此刻还不知道 team_id，无法提供租户上下文，
 * 而 api_keys 受 RLS 约束（策略要求 app.team_id）。RLS 启用后此处必须改为
 * 特权路径（类似 webhook 的 SECURITY DEFINER 查询函数）才能定位到 key 所属租户。
 * 这里保持原样，待补齐特权函数后切换。
 */
export async function getApiKeyByHash(keyHash: string) {
  const result = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)))
    .limit(1);
  return result[0] ?? null;
}

export async function getRecentUsageForTeam(teamId: number, limit = 20) {
  return await withTenantContext(teamId, null, async (tx) => {
    return await tx
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.teamId, teamId))
      .orderBy(desc(usageRecords.createdAt))
      .limit(limit);
  });
}

// ─────────────────────────────────────────────
// 平台管理后台
// ─────────────────────────────────────────────

/**
 * 跨租户聚合（平台后台）：无法提供 team 上下文，走特权聚合函数
 * （SECURITY DEFINER，见 0010_privileged_functions.sql），不能用 withTenantContext 包装。
 * 函数返回 camelCase 的 jsonb，此处还原为与 drizzle 一致的类型（时间转回 Date）。
 */
export async function getAllTeamsWithStats(): Promise<
  (InferSelectModel<typeof teams> & { memberCount: number })[]
> {
  const rows = (await db.execute(
    sql`SELECT team, member_count FROM app_all_teams_with_stats()`
  )) as unknown as {
    team: InferSelectModel<typeof teams>;
    member_count: number | string;
  }[];

  return rows.map((r) => ({
    ...r.team,
    createdAt: new Date(r.team.createdAt),
    updatedAt: new Date(r.team.updatedAt),
    memberCount: Number(r.member_count),
  }));
}

// users 为全局表，不受 RLS 约束。
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

export async function getShopsForTeam(teamId: number, tx?: TenantTx) {
  return runWithContext(teamId, null, tx, async (t) => {
    return await t
      .select()
      .from(shops)
      .where(and(eq(shops.teamId, teamId), isNull(shops.deletedAt)))
      .orderBy(desc(shops.createdAt));
  });
}

export async function getShopById(shopId: number, teamId: number, tx?: TenantTx) {
  return runWithContext(teamId, null, tx, async (t) => {
    const result = await t
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
  });
}

export async function getProductsForTeam(
  teamId: number,
  shopId?: number,
  tx?: TenantTx
) {
  return runWithContext(teamId, null, tx, async (t) => {
    const conditions = [
      eq(products.teamId, teamId),
      isNull(products.deletedAt),
    ];
    if (shopId) {
      conditions.push(eq(products.shopId, shopId));
    }
    return await t
      .select()
      .from(products)
      .where(and(...conditions))
      .orderBy(desc(products.createdAt));
  });
}

export async function getProductById(productId: number, teamId: number) {
  return await withTenantContext(teamId, null, async (tx) => {
    const result = await tx
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
  });
}

export async function getOrdersForTeam(teamId: number, shopId?: number) {
  return await withTenantContext(teamId, null, async (tx) => {
    const conditions = [eq(orders.teamId, teamId)];
    if (shopId) {
      conditions.push(eq(orders.shopId, shopId));
    }
    return await tx
      .select()
      .from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.orderedAt))
      .limit(200);
  });
}

export async function getAiContentsForTeam(teamId: number, scene?: string) {
  return await withTenantContext(teamId, null, async (tx) => {
    const conditions = [eq(aiContents.teamId, teamId)];
    if (scene) {
      conditions.push(eq(aiContents.scene, scene));
    }
    return await tx
      .select()
      .from(aiContents)
      .where(and(...conditions))
      .orderBy(desc(aiContents.createdAt))
      .limit(50);
  });
}

/**
 * 统计团队电商数据概览（用于数据分析场景）。
 */
export async function getEcommerceStats(teamId: number) {
  return await withTenantContext(teamId, null, async (tx) => {
    const [shopCount] = await tx
      .select({ value: count() })
      .from(shops)
      .where(and(eq(shops.teamId, teamId), isNull(shops.deletedAt)));

    const [productCount] = await tx
      .select({ value: count() })
      .from(products)
      .where(and(eq(products.teamId, teamId), isNull(products.deletedAt)));

    const [orderCount] = await tx
      .select({ value: count() })
      .from(orders)
      .where(eq(orders.teamId, teamId));

    const [revenue] = await tx
      .select({ value: sql<number>`COALESCE(SUM(amount), 0)` })
      .from(orders)
      .where(eq(orders.teamId, teamId));

    return {
      shopCount: Number(shopCount?.value ?? 0),
      productCount: Number(productCount?.value ?? 0),
      orderCount: Number(orderCount?.value ?? 0),
      totalRevenue: Number(revenue?.value ?? 0),
    };
  });
}

/**
 * 订单按状态聚合（用于图表）。
 */
export async function getOrderStatusBreakdown(teamId: number) {
  return await withTenantContext(teamId, null, async (tx) => {
    const rows = await tx
      .select({
        status: orders.status,
        value: count(),
      })
      .from(orders)
      .where(eq(orders.teamId, teamId))
      .groupBy(orders.status);

    return rows.map((r) => ({ status: r.status, count: Number(r.value) }));
  });
}

/**
 * 近 N 天订单量趋势（用于折线图）。
 */
export async function getOrderTrend(teamId: number, days = 14) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  return await withTenantContext(teamId, null, async (tx) => {
    const rows = await tx
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
  });
}

/**
 * 商品销量 TOP N（用于柱状图）。
 */
export async function getTopProducts(teamId: number, limit = 10) {
  return await withTenantContext(teamId, null, async (tx) => {
    const rows = await tx
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
  });
}

/**
 * 各商品品类数量分布（用于饼图）。
 */
export async function getCategoryDistribution(teamId: number) {
  return await withTenantContext(teamId, null, async (tx) => {
    const rows = await tx
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
  });
}
