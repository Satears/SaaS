import { NextResponse } from 'next/server';
import { requireTenantApi, requireRole } from '@/lib/auth/rbac';
import { settleOverageLedger } from '@/lib/billing/metered';

/**
 * 结算超额账单：对 pending 状态的 overage 记录触发 Stripe 开票。
 * 仅 owner/admin 可操作。
 */
export async function POST() {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    requireRole(ctx, 'admin');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await settleOverageLedger(ctx.team.id);
  return NextResponse.json(result);
}
