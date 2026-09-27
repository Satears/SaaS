import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantApi, requireRole } from '@/lib/auth/rbac';
import { updateKnowledge, deleteKnowledge } from '@/lib/ai/knowledge';

const updateSchema = z.object({
  question: z.string().min(1).max(500).optional(),
  answer: z.string().min(1).max(5000).optional(),
  category: z.string().max(100).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  enabled: z.boolean().optional(),
});

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
  const updated = await updateKnowledge(Number(id), ctx.team.id, body);
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

  await deleteKnowledge(Number(id), ctx.team.id);
  return NextResponse.json({ success: true });
}
