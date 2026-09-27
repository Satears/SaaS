import { NextRequest, NextResponse } from 'next/server';
import { requireTenantApi, requireRole } from '@/lib/auth/rbac';
import { getShopById } from '@/lib/db/queries';
import { getPlatformAdapter } from '@/lib/ecommerce/platforms';
import { signOAuthState } from '@/lib/ecommerce/oauth-state';
import { getBaseUrl } from '@/lib/utils';

/**
 * 发起平台 OAuth 授权：生成授权跳转 URL。
 * POST body: { shopId }
 */
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

  const adapter = getPlatformAdapter(shop.platform);
  const redirectUri = `${getBaseUrl()}/api/ecommerce/oauth/callback`;

  try {
    const state = await signOAuthState({ shopId: shop.id, teamId: ctx.team.id });
    const authUrl = adapter.buildAuthUrl({
      teamId: ctx.team.id,
      shopId: shop.id,
      redirectUri,
      state,
    });
    return NextResponse.json({ authUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 501 });
  }
}
