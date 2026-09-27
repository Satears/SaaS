import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { products } from '@/lib/db/schema';
import { requireTenantApi, requireRole } from '@/lib/auth/rbac';
import { getProductsForTeam } from '@/lib/db/queries';

const createSchema = z.object({
  shopId: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  category: z.string().max(100).optional(),
  price: z.number().nonnegative().optional(),
  sku: z.string().max(100).optional(),
  attributes: z.record(z.any()).optional(),
});

export async function GET(request: NextRequest) {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const shopId = request.nextUrl.searchParams.get('shopId');
  const list = await getProductsForTeam(
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

  const [product] = await db
    .insert(products)
    .values({
      teamId: ctx.team.id,
      shopId: body.shopId,
      title: body.title,
      description: body.description ?? null,
      category: body.category ?? null,
      price: body.price?.toString() ?? null,
      sku: body.sku ?? null,
      attributes: body.attributes ?? null,
    })
    .returning();

  return NextResponse.json(product, { status: 201 });
}
