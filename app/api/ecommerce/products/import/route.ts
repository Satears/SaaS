import { NextRequest, NextResponse } from 'next/server';
import { withTenantContext } from '@/lib/db/tenant';
import { products } from '@/lib/db/schema';
import { requireTenantApi, requireRole } from '@/lib/auth/rbac';
import { getProductsForTeam, getShopById } from '@/lib/db/queries';
import { checkProductQuota } from '@/lib/billing/quota';
import { csvToObjects, productTemplateCsv } from '@/lib/ecommerce/csv';

/**
 * 商品批量导入字段映射：CSV 表头 → 商品字段。
 * 额外列（如 color/size/material）会合并进 attributes。
 */
const FIELD_MAP: Record<string, string> = {
  title: 'title',
  name: 'title',
  名称: 'title',
  商品名称: 'title',
  description: 'description',
  描述: 'description',
  category: 'category',
  分类: 'category',
  price: 'price',
  价格: 'price',
  sku: 'sku',
  'sku编码': 'sku',
};

const ATTRIBUTE_KEYS = new Set(['color', 'size', 'material', '颜色', '尺码', '材质', '品牌', 'brand', 'weight', '重量']);

export async function GET() {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // 返回 CSV 模板
  return new NextResponse(productTemplateCsv(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="products-template.csv"',
    },
  });
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

  let shopId: number;
  let csvText: string;

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const shopIdRaw = form.get('shopId');
    const file = form.get('file') as File | null;
    if (!shopIdRaw || !file) {
      return NextResponse.json(
        { error: 'shopId and file are required' },
        { status: 400 }
      );
    }
    shopId = Number(shopIdRaw);
    csvText = await file.text();
  } else {
    const body = await request.json();
    shopId = Number(body.shopId);
    csvText = body.csv;
  }

  if (!shopId || !csvText) {
    return NextResponse.json(
      { error: 'shopId and csv are required' },
      { status: 400 }
    );
  }

  // 门店归属校验：shopId 来自客户端，必须确认属于当前租户
  const shop = await withTenantContext(ctx.team.id, ctx.user.id, (tx) =>
    getShopById(shopId, ctx.team.id, tx)
  );
  if (!shop) {
    return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  }

  // 解析 CSV
  const rows = csvToObjects(csvText);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Empty CSV' }, { status: 400 });
  }

  // 逐行解析并校验
  const validRows: typeof products.$inferInsert[] = [];
  const errors: { row: number; message: string }[] = [];

  rows.forEach((row, idx) => {
    const mapped: Record<string, any> = {};
    const attributes: Record<string, string> = {};

    for (const [rawKey, rawVal] of Object.entries(row)) {
      const key = rawKey.trim();
      const val = rawVal.trim();
      if (!key) continue;

      const fieldName = FIELD_MAP[key];
      if (fieldName) {
        mapped[fieldName] = val;
      } else if (ATTRIBUTE_KEYS.has(key)) {
        if (val) attributes[key] = val;
      }
      // 其他未知列忽略
    }

    const title = (mapped.title ?? '').trim();
    if (!title) {
      errors.push({ row: idx + 2, message: 'Missing title' });
      return;
    }

    const priceRaw = mapped.price ? String(mapped.price).replace(/[¥￥,\s]/g, '') : null;
    const price = priceRaw ? Number(priceRaw) : null;
    if (priceRaw && Number.isNaN(price)) {
      errors.push({ row: idx + 2, message: `Invalid price: ${mapped.price}` });
      return;
    }

    validRows.push({
      teamId: ctx.team.id,
      shopId,
      title: title.slice(0, 200),
      description: mapped.description ? String(mapped.description).slice(0, 5000) : null,
      category: mapped.category ? String(mapped.category).slice(0, 100) : null,
      price: price !== null ? price.toString() : null,
      sku: mapped.sku ? String(mapped.sku).slice(0, 100) : null,
      attributes: Object.keys(attributes).length > 0 ? attributes : null,
    });
  });

  // 配额预检 + 批量写入，同一租户事务内完成
  const result = await withTenantContext(ctx.team.id, ctx.user.id, async (tx) => {
    const existing = await getProductsForTeam(ctx.team.id, shopId, tx);
    const quota = await checkProductQuota(ctx.team, existing.length, rows.length);
    if (!quota.allowed) {
      return { error: quota.reason ?? 'Product quota exceeded' };
    }

    // 批量写入（分批，避免单条插入过多）
    const BATCH = 200;
    let inserted = 0;
    for (let i = 0; i < validRows.length; i += BATCH) {
      const batch = validRows.slice(i, i + BATCH);
      const created = await tx.insert(products).values(batch).returning({ id: products.id });
      inserted += created.length;
    }
    return { inserted };
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 402 });
  }

  return NextResponse.json({
    success: true,
    total: rows.length,
    inserted: result.inserted,
    errors,
  });
}
