import 'server-only';

/**
 * 门店/小程序接入适配器抽象层。
 *
 * 本地商家门店可来自不同来源：小程序（商城/预约/会员）或第三方电商平台
 * （Shopify / 淘宝 / 京东 / 拼多多 / 抖音 / Amazon 等）。
 * 每个来源实现统一的 PlatformAdapter 接口，提供：
 * - OAuth 授权 URL 生成与回调处理
 * - 商品同步（拉取平台商品 → 写入本地 products 表）
 * - 订单同步（拉取订单 → 写入本地 orders 表）
 *
 * 当前为「接入框架 + Shopify 参考实现」，
 * 其他来源按需补充 adapter 并注册到 REGISTRY。
 */

export type PlatformName =
  | 'miniprogram'
  | 'shopify'
  | 'taobao'
  | 'jd'
  | 'pdd'
  | 'douyin'
  | 'amazon';

export type SyncedProduct = {
  externalId: string;
  title: string;
  description?: string;
  category?: string;
  price?: string;
  sku?: string;
  images?: string[];
  attributes?: Record<string, any>;
};

export type SyncedOrder = {
  externalId: string;
  orderNo?: string;
  amount?: string;
  quantity?: number;
  status?: string;
  customerId?: string;
  orderedAt?: Date;
};

export interface PlatformAdapter {
  readonly name: PlatformName;
  readonly displayName: string;

  /** 生成 OAuth 授权跳转 URL（将用户带到平台授权页）。state 由调用方签名后传入。 */
  buildAuthUrl(params: {
    teamId: number;
    shopId: number;
    redirectUri: string;
    state: string;
  }): string;

  /** 处理 OAuth 回调，返回访问凭证。 */
  handleAuthCallback(params: {
    code: string;
    redirectUri: string;
  }): Promise<{
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
    externalShopId?: string;
  }>;

  /** 拉取平台商品列表。 */
  syncProducts(params: { accessToken: string; externalShopId?: string }): Promise<SyncedProduct[]>;

  /** 拉取平台订单列表。 */
  syncOrders(params: { accessToken: string; externalShopId?: string }): Promise<SyncedOrder[]>;
}

/**
 * Shopify 参考实现（REST Admin API）。
 * 需要 SHOPIFY_API_KEY / SHOPIFY_API_SECRET 环境变量。
 */
class ShopifyAdapter implements PlatformAdapter {
  readonly name = 'shopify' as const;
  readonly displayName = 'Shopify';

  buildAuthUrl({
    state,
    redirectUri,
  }: {
    teamId: number;
    shopId: number;
    redirectUri: string;
    state: string;
  }) {
    // 简化：实际需要 shop 域名。此处返回占位 URL，真实实现需用户先填 shop 域名。
    const apiKey = process.env.SHOPIFY_API_KEY ?? '';
    const scopes = 'read_products,read_orders';
    const shop = process.env.SHOPIFY_TEST_SHOP ?? 'example.myshopify.com';
    return (
      `https://${shop}/admin/oauth/authorize?client_id=${apiKey}` +
      `&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`
    );
  }

  async handleAuthCallback(params: { code: string; redirectUri: string }) {
    const shop = process.env.SHOPIFY_TEST_SHOP ?? '';
    const apiKey = process.env.SHOPIFY_API_KEY ?? '';
    const apiSecret = process.env.SHOPIFY_API_SECRET ?? '';

    if (!shop || !apiKey || !apiSecret) {
      throw new Error('SHOPIFY_API_KEY / SHOPIFY_API_SECRET / SHOPIFY_TEST_SHOP not configured');
    }

    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: apiSecret,
        code: params.code,
      }),
    });

    if (!res.ok) {
      throw new Error(`Shopify OAuth failed (${res.status})`);
    }

    const data = await res.json();
    return {
      accessToken: data.access_token,
      refreshToken: undefined,
      tokenExpiresAt: undefined,
      externalShopId: shop,
    };
  }

  async syncProducts(params: { accessToken: string; externalShopId?: string }) {
    const shop = params.externalShopId ?? process.env.SHOPIFY_TEST_SHOP ?? '';
    const res = await fetch(
      `https://${shop}/admin/api/2024-01/products.json?limit=250`,
      { headers: { 'X-Shopify-Access-Token': params.accessToken } }
    );
    if (!res.ok) throw new Error(`Shopify product sync failed (${res.status})`);
    const data = await res.json();
    return (data.products ?? []).map((p: any) => ({
      externalId: String(p.id),
      title: p.title,
      description: p.body_html,
      category: p.product_type,
      price: p.variants?.[0]?.price,
      sku: p.variants?.[0]?.sku,
      images: p.images?.map((img: any) => img.src),
      attributes: { vendor: p.vendor, tags: p.tags },
    }));
  }

  async syncOrders(params: { accessToken: string; externalShopId?: string }) {
    const shop = params.externalShopId ?? process.env.SHOPIFY_TEST_SHOP ?? '';
    const res = await fetch(
      `https://${shop}/admin/api/2024-01/orders.json?limit=250`,
      { headers: { 'X-Shopify-Access-Token': params.accessToken } }
    );
    if (!res.ok) throw new Error(`Shopify order sync failed (${res.status})`);
    const data = await res.json();
    return (data.orders ?? []).map((o: any) => ({
      externalId: String(o.id),
      orderNo: o.name,
      amount: o.total_price,
      quantity: o.line_items?.reduce((acc: number, li: any) => acc + li.quantity, 0) ?? 1,
      status: o.financial_status,
      customerId: String(o.customer?.id ?? ''),
      orderedAt: o.created_at ? new Date(o.created_at) : undefined,
    }));
  }
}

/**
 * 占位适配器：未实现的平台返回清晰的错误，避免静默失败。
 */
class UnsupportedAdapter implements PlatformAdapter {
  readonly name: PlatformName;
  readonly displayName: string;

  constructor(name: PlatformName, displayName: string) {
    this.name = name;
    this.displayName = displayName;
  }

  buildAuthUrl(_params: { teamId: number; shopId: number; redirectUri: string; state: string }): string {
    throw new Error(`平台「${this.displayName}」接入尚未实现`);
  }
  async handleAuthCallback(_params: { code: string; redirectUri: string }): Promise<{
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
    externalShopId?: string;
  }> {
    throw new Error(`平台「${this.displayName}」接入尚未实现`);
  }
  async syncProducts(_params: { accessToken: string; externalShopId?: string }): Promise<SyncedProduct[]> {
    throw new Error(`平台「${this.displayName}」同步尚未实现`);
  }
  async syncOrders(_params: { accessToken: string; externalShopId?: string }): Promise<SyncedOrder[]> {
    throw new Error(`平台「${this.displayName}」同步尚未实现`);
  }
}

const REGISTRY: Record<PlatformName, PlatformAdapter> = {
  // 本地商家默认来源：小程序（商城/预约/会员），由时光机代运营团队协助开通。
  miniprogram: new UnsupportedAdapter('miniprogram', '小程序'),
  shopify: new ShopifyAdapter(),
  taobao: new UnsupportedAdapter('taobao', '淘宝'),
  jd: new UnsupportedAdapter('jd', '京东'),
  pdd: new UnsupportedAdapter('pdd', '拼多多'),
  douyin: new UnsupportedAdapter('douyin', '抖音'),
  amazon: new UnsupportedAdapter('amazon', 'Amazon'),
};

export function getPlatformAdapter(platform: string): PlatformAdapter {
  const adapter = REGISTRY[platform as PlatformName];
  if (!adapter) {
    return new UnsupportedAdapter(platform as PlatformName, platform);
  }
  return adapter;
}

export function listPlatforms(): { id: PlatformName; displayName: string }[] {
  return Object.values(REGISTRY).map((a) => ({ id: a.name, displayName: a.displayName }));
}
