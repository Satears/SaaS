import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTenantContext } from '@/lib/db/tenant';
import { eq, and } from 'drizzle-orm';
import { aiProjects } from '@/lib/db/schema';
import { requireTenantApi, requireRole } from '@/lib/auth/rbac';
import { getAiProjectById } from '@/lib/db/queries';

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  model: z.string().max(100).optional(),
  systemPrompt: z.string().max(4000).nullable().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const project = await getAiProjectById(Number(id), ctx.team.id);
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(project);
}

export async function PATCH(
  request: NextRequest,
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

  const body = updateSchema.parse(await request.json());

  const updated = await withTenantContext(ctx.team.id, ctx.user.id, async (tx) => {
    const [row] = await tx
      .update(aiProjects)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(aiProjects.id, Number(id)), eq(aiProjects.teamId, ctx.team.id)))
      .returning();
    return row ?? null;
  });

  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(updated);
}

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

  // 软删除
  await withTenantContext(ctx.team.id, ctx.user.id, async (tx) => {
    await tx
      .update(aiProjects)
      .set({ deletedAt: new Date() })
      .where(and(eq(aiProjects.id, Number(id)), eq(aiProjects.teamId, ctx.team.id)));
  });

  return NextResponse.json({ success: true });
}
