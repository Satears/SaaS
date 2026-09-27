import 'server-only';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db/drizzle';
import { eq, and } from 'drizzle-orm';
import { billingLedger, teams } from '@/lib/db/schema';

/**
 * Stripe metered billing 对接：把超额用量（token）上报到 Stripe 计量，
 * 用于按量计费 + 自动开票。
 *
 * 工作方式：
 * - 通过 Stripe Billing Meter 记录「超额 token」用量事件
 * - 账单周期结束时，Stripe 根据 meter 用量生成发票
 * - 本模块封装：上报用量 + 关联 ledger 记录到 Stripe invoice
 *
 * 注意：实际启用需在 Stripe Dashboard 创建 billing meter 并配置价格。
 * 未配置时本模块安全降级（不报错、仅记录日志）。
 */

// 从环境变量读取 meter 名称（可选配置）
function getMeterName(): string | null {
  return process.env.STRIPE_OVERAGE_METER_NAME ?? null;
}

/**
 * 上报超额用量到 Stripe Billing Meter。
 * 若未配置 meter 则跳过（安全降级）。
 */
export async function reportOverageToStripe(params: {
  team: typeof teams.$inferSelect;
  overageTokens: number;
  period: string; // YYYY-MM
}) {
  const meterName = getMeterName();
  if (!meterName || !params.team.stripeCustomerId) {
    // 未配置 meter 或团队无 Stripe customer，跳过
    return { reported: false, reason: 'meter or customer not configured' };
  }

  try {
    // Stripe Billing Meter 事件（v2 API）
    await stripe.v2.billing.meterEvents.create({
      event_name: meterName,
      identifier: `${params.team.id}:${params.period}`, // 幂等标识
      payload: {
        value: String(params.overageTokens),
        stripe_customer_id: params.team.stripeCustomerId,
      },
      timestamp: new Date().toISOString(),
    });

    return { reported: true };
  } catch (e: any) {
    console.error('Failed to report overage to Stripe:', e.message);
    return { reported: false, reason: e.message };
  }
}

/**
 * 生成超额发票：调用 Stripe invoice API 为团队创建应付账单。
 * 未配置时安全降级。
 */
export async function createOverageInvoice(params: {
  team: typeof teams.$inferSelect;
  amountCents: number;
  period: string;
  description?: string;
}) {
  if (!params.team.stripeCustomerId || params.amountCents <= 0) {
    return { created: false, reason: 'no customer or zero amount' };
  }

  try {
    // 创建 invoice item，然后生成发票
    await stripe.invoiceItems.create({
      customer: params.team.stripeCustomerId,
      amount: params.amountCents,
      currency: 'usd',
      description:
        params.description ?? `Overage usage ${params.period}（超额 token 按量计费）`,
    });

    const invoice = await stripe.invoices.create({
      customer: params.team.stripeCustomerId,
      auto_advance: true,
      collection_method: 'send_invoice',
      days_until_due: 7,
    });

    if (invoice.id) {
      await stripe.invoices.finalizeInvoice(invoice.id);
    }

    return { created: true, invoiceId: invoice.id ?? null };
  } catch (e: any) {
    console.error('Failed to create overage invoice:', e.message);
    return { created: false, reason: e.message };
  }
}

/**
 * 结算超额账单：对 pending 状态的 overage 记录，
 * 上报 Stripe meter + 创建发票，并把 ledger 标记为 invoiced。
 */
export async function settleOverageLedger(teamId: number) {
  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);

  if (!team) return { settled: false, reason: 'team not found' };

  const pending = await db
    .select()
    .from(billingLedger)
    .where(
      and(
        eq(billingLedger.teamId, teamId),
        eq(billingLedger.kind, 'overage'),
        eq(billingLedger.status, 'pending')
      )
    );

  const results = [];
  for (const entry of pending) {
    if (entry.amountCents <= 0) {
      // 零费用直接标记为 waived
      await db
        .update(billingLedger)
        .set({ status: 'waived', updatedAt: new Date() })
        .where(eq(billingLedger.id, entry.id));
      results.push({ entryId: entry.id, status: 'waived' });
      continue;
    }

    const invoice = await createOverageInvoice({
      team,
      amountCents: entry.amountCents,
      period: entry.period,
      description: entry.description ?? undefined,
    });

    if (invoice.created && invoice.invoiceId) {
      await db
        .update(billingLedger)
        .set({
          status: 'invoiced',
          stripeInvoiceId: invoice.invoiceId,
          updatedAt: new Date(),
        })
        .where(eq(billingLedger.id, entry.id));
      results.push({ entryId: entry.id, status: 'invoiced', invoiceId: invoice.invoiceId });
    } else {
      results.push({ entryId: entry.id, status: 'pending', reason: invoice.reason });
    }
  }

  return { settled: true, results };
}
