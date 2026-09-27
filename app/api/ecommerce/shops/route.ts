import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { shops } from '@/lib/db/schema';
import { requireTenantApi, requireRole } from '@/lib/auth/rbac';
import { getShopsForTeam } from '@/lib/db/queries';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  platform: z.string().max(30).optional(),
  domain: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  currency: z.string().max(10).optional(),
});

export async function GET() {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const list = await getShopsForTeam(ctx.team.id);
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

  const [shop] = await db
    .insert(shops)
    .values({
      teamId: ctx.team.id,
      name: body.name,
      platform: body.platform ?? 'miniprogram',
      domain: body.domain ?? null,
      category: body.category ?? null,
      currency: body.currency ?? 'CNY',
    })
    .returning();

  return NextResponse.json(shop, { status: 201 });
}
