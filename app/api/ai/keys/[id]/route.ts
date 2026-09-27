import { NextRequest, NextResponse } from 'next/server';
import { withTenantContext } from '@/lib/db/tenant';
import { eq, and } from 'drizzle-orm';
import { apiKeys } from '@/lib/db/schema';
import { requireTenantApi, requireRole } from '@/lib/auth/rbac';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    requireRole(ctx, 'admin');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await withTenantContext(ctx.team.id, ctx.user.id, async (tx) => {
    await tx
      .update(apiKeys)
      .set({ isActive: false, revokedAt: new Date() })
      .where(and(eq(apiKeys.id, Number(id)), eq(apiKeys.teamId, ctx.team.id)));
  });

  return NextResponse.json({ success: true });
}
