import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { eq, and } from 'drizzle-orm';
import { shops, products, orders } from '@/lib/db/schema';
import { requireTenantApi, requireRole } from '@/lib/auth/rbac';
import { getShopById } from '@/lib/db/queries';
import { getPlatformAdapter, listPlatforms } from '@/lib/ecommerce/platforms';

// GET: 列出支持的平台
export async function GET() {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(listPlatforms());
}

// POST: 触发门店同步（拉取商品 + 订单）
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

  const body = await request.json();
  const shopId = Number(body.shopId);
  if (!shopId) {
    return NextResponse.json({ error: 'shopId required' }, { status: 400 });
  }

  const shop = await getShopById(shopId, ctx.team.id);
  if (!shop) {
    return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  }
  if (!shop.accessToken) {
    return NextResponse.json(
      { error: '门店尚未接入渠道（无访问凭证）' },
      { status: 400 }
    );
  }

  const adapter = getPlatformAdapter(shop.platform);

  // 更新同步状态
  await db
    .update(shops)
    .set({ syncStatus: 'syncing', updatedAt: new Date() })
    .where(and(eq(shops.id, shop.id), eq(shops.teamId, ctx.team.id)));

  try {
    const [syncedProducts, syncedOrders] = await Promise.all([
      adapter.syncProducts({ accessToken: shop.accessToken, externalShopId: shop.externalShopId ?? undefined }),
      adapter.syncOrders({ accessToken: shop.accessToken, externalShopId: shop.externalShopId ?? undefined }),
    ]);

    // 写入商品（批量）
    let productCount = 0;
    for (const p of syncedProducts) {
      await db.insert(products).values({
        teamId: ctx.team.id,
        shopId: shop.id,
        title: p.title.slice(0, 200),
        description: p.description ?? null,
        category: p.category ?? null,
        price: p.price ?? null,
        sku: p.sku ?? null,
        images: p.images ?? null,
        attributes: p.attributes ?? null,
      });
      productCount++;
    }

    // 写入订单（批量）
    let orderCount = 0;
    for (const o of syncedOrders) {
      await db.insert(orders).values({
        teamId: ctx.team.id,
        shopId: shop.id,
        orderNo: o.orderNo ?? null,
        amount: o.amount ?? null,
        quantity: o.quantity ?? 1,
        status: o.status ?? 'paid',
        customerId: o.customerId ?? null,
        orderedAt: o.orderedAt ?? new Date(),
      });
      orderCount++;
    }

    await db
      .update(shops)
      .set({ syncStatus: 'connected', lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(shops.id, shop.id), eq(shops.teamId, ctx.team.id)));

    return NextResponse.json({
      success: true,
      products: productCount,
      orders: orderCount,
    });
  } catch (e: any) {
    await db
      .update(shops)
      .set({ syncStatus: 'error', updatedAt: new Date() })
      .where(and(eq(shops.id, shop.id), eq(shops.teamId, ctx.team.id)));
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
