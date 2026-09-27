import { NextResponse } from 'next/server';
import { requireTenantApi } from '@/lib/auth/rbac';
import { getTeamQuota, getTeamUsage, getRecentUsageForTeam } from '@/lib/db/queries';

export async function GET() {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [quota, usage, recent] = await Promise.all([
    getTeamQuota(ctx.team),
    getTeamUsage(ctx.team.id),
    getRecentUsageForTeam(ctx.team.id, 20),
  ]);

  return NextResponse.json({ quota, usage, recent });
}
