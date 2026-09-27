import { NextRequest, NextResponse } from 'next/server';
import { withTenantContext } from '@/lib/db/tenant';
import { eq, and } from 'drizzle-orm';
import { shops } from '@/lib/db/schema';
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
      .update(shops)
      .set({ deletedAt: new Date() })
      .where(and(eq(shops.id, Number(id)), eq(shops.teamId, ctx.team.id)));
  });

  return NextResponse.json({ success: true });
}
