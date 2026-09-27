import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantApi, requireRole } from '@/lib/auth/rbac';
import { listKnowledge, createKnowledge } from '@/lib/ai/knowledge';

const createSchema = z.object({
  shopId: z.number().int().positive().optional().nullable(),
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(5000),
  category: z.string().max(100).optional(),
  tags: z.array(z.string()).optional(),
});

export async function GET(request: NextRequest) {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const shopId = request.nextUrl.searchParams.get('shopId');
  const list = await listKnowledge(
    ctx.team.id,
    shopId ? Number(shopId) : undefined
  );
  return NextResponse.json(list);
}

export async function POST(request: NextRequest) {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    requireRole(ctx, 'admin');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = createSchema.parse(await request.json());
  const entry = await createKnowledge({
    teamId: ctx.team.id,
    shopId: body.shopId ?? null,
    question: body.question,
    answer: body.answer,
    category: body.category ?? null,
    tags: body.tags ?? null,
  });

  return NextResponse.json(entry, { status: 201 });
}
