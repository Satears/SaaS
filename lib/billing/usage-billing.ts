import 'server-only';
import { db } from '@/lib/db/drizzle';
import { eq, and, sql } from 'drizzle-orm';
import { billingLedger, usageRecords } from '@/lib/db/schema';
import { getTeamQuota } from '@/lib/db/queries';

/**
 * 用量计费：超出订阅配额的 token 按量计费。
 *
 * 计费模型：
 * - 订阅套餐提供每月免费 token 配额（quotaTokenMonthly）
 * - 超出部分按「超额 token 单价」计费（可配置，见 OVERAGE_RATE_PER_1K）
 * - 每个账单周期（自然月）生成一条 overage 账单记录
 */

// 超额定价：每 1k token 的计费（分）。可按 tier 扩展。
const OVERAGE_RATE_PER_1K: Record<string, { in: number; out: number }> = {
  free: { in: 0, out: 0 }, // free 不超额计费（配额用完即拦截）
  pro: { in: 0.006, out: 0.018 },
  business: { in: 0.005, out: 0.015 },
  enterprise: { in: 0.004, out: 0.012 },
};

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 计算本月超额用量与费用。
 */
export async function calculateOverage(team: { id: number; planTier: string; customQuota: any }) {
  const quota = await getTeamQuota(team);
  const period = currentPeriod();

  // 本月总 token（含 input + output）
  const [usage] = await db
    .select({
      totalTokens: sql<number>`COALESCE(SUM(input_tokens + output_tokens), 0)`,
    })
    .from(usageRecords)
    .where(eq(usageRecords.teamId, team.id));

  const totalTokens = Number(usage?.totalTokens ?? 0);
  const quotaTokens = quota.quotaTokenMonthly ?? 0;
  const overageTokens = Math.max(0, totalTokens - quotaTokens);

  const rate = OVERAGE_RATE_PER_1K[team.planTier] ?? OVERAGE_RATE_PER_1K.pro;
  // 超额 token 按 output 价估算（简化：统一按 out 计费）
  const amountCents = Math.round((overageTokens / 1000) * rate.out);

  return {
    period,
    totalTokens,
    quotaTokens,
    overageTokens,
    amountCents,
    currency: 'usd',
  };
}

/**
 * 生成/更新本月超额账单记录（幂等：同一周期只保留一条 pending 记录）。
 */
export async function syncOverageLedger(team: { id: number; planTier: string; customQuota: any }) {
  const overage = await calculateOverage(team);
  const period = overage.period;

  const existing = await db
    .select()
    .from(billingLedger)
    .where(
      and(
        eq(billingLedger.teamId, team.id),
        eq(billingLedger.period, period),
        eq(billingLedger.kind, 'overage')
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // 更新已有记录（仅当 status 仍为 pending）
    const record = existing[0];
    if (record.status === 'pending') {
      await db
        .update(billingLedger)
        .set({
          overageTokens: overage.overageTokens,
          amountCents: overage.amountCents,
          updatedAt: new Date(),
        })
        .where(eq(billingLedger.id, record.id));
    }
    return record;
  }

  // 创建新记录
  const [created] = await db
    .insert(billingLedger)
    .values({
      teamId: team.id,
      period,
      kind: 'overage',
      description: `Overage usage for ${period}`,
      overageTokens: overage.overageTokens,
      amountCents: overage.amountCents,
      currency: overage.currency,
      status: 'pending',
    })
    .returning();

  return created;
}

/**
 * 获取租户的账单明细列表。
 */
export async function getLedgerForTeam(teamId: number) {
  return await db
    .select()
    .from(billingLedger)
    .where(eq(billingLedger.teamId, teamId))
    .orderBy(sql`created_at DESC`);
}

/**
 * 获取租户当前未结清（pending/invoiced）的超额费用总和。
 */
export async function getOutstandingOverage(teamId: number) {
  const [result] = await db
    .select({
      amount: sql<number>`COALESCE(SUM(amount_cents), 0)`,
    })
    .from(billingLedger)
    .where(
      and(
        eq(billingLedger.teamId, teamId),
        sql`status IN ('pending', 'invoiced')`
      )
    );

  return Number(result?.amount ?? 0);
}
