import { NextResponse } from 'next/server';
import { requireTenantApi } from '@/lib/auth/rbac';
import {
  calculateOverage,
  getLedgerForTeam,
  getOutstandingOverage,
} from '@/lib/billing/usage-billing';

export async function GET() {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [overage, ledger, outstanding] = await Promise.all([
    calculateOverage(ctx.team),
    getLedgerForTeam(ctx.team.id),
    getOutstandingOverage(ctx.team.id),
  ]);

  return NextResponse.json({
    current: overage,
    ledger,
    outstandingOverageCents: outstanding,
  });
}
