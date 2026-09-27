import { NextRequest, NextResponse } from 'next/server';
import { requireTenantApi } from '@/lib/auth/rbac';
import {
  getEcommerceStats,
  getOrderStatusBreakdown,
  getOrderTrend,
  getTopProducts,
  getCategoryDistribution,
} from '@/lib/db/queries';

export async function GET(request: NextRequest) {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const days = Number(request.nextUrl.searchParams.get('days') ?? 14);

  const [stats, statusBreakdown, trend, topProducts, categories] =
    await Promise.all([
      getEcommerceStats(ctx.team.id),
      getOrderStatusBreakdown(ctx.team.id),
      getOrderTrend(ctx.team.id, days),
      getTopProducts(ctx.team.id),
      getCategoryDistribution(ctx.team.id),
    ]);

  return NextResponse.json({
    stats,
    statusBreakdown,
    trend,
    topProducts,
    categories,
  });
}
