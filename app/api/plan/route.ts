import { NextResponse } from 'next/server';
import { requireTenantApi } from '@/lib/auth/rbac';
import { getTeamPlanCapabilities } from '@/lib/db/queries';

export async function GET() {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const capabilities = await getTeamPlanCapabilities(ctx.team);
  return NextResponse.json(capabilities);
}
