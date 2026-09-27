import { NextRequest, NextResponse } from 'next/server';
import { withTenantContext } from '@/lib/db/tenant';
import { eq } from 'drizzle-orm';
import { shops } from '@/lib/db/schema';
import { getShopById } from '@/lib/db/queries';
import { getPlatformAdapter } from '@/lib/ecommerce/platforms';
import { verifyOAuthState } from '@/lib/ecommerce/oauth-state';
import { getBaseUrl } from '@/lib/utils';

/**
 * OAuth 回调：先校验 state 签名还原门店归属，再保存访问凭证。
 * 由平台授权后跳转，state 为签名令牌（含 shopId + teamId），
 * 避免攻击者篡改 state 把凭证写到其他团队的门店上。
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');

  if (!code || !state) {
    return NextResponse.json({ error: '缺少 code 或 state' }, { status: 400 });
  }

  const payload = await verifyOAuthState(state);
  if (!payload) {
    return NextResponse.json({ error: 'state 校验失败' }, { status: 400 });
  }

  // 以 state 中的 teamId 限定查询，确保凭证只能写回本团队的门店
  const shop = await getShopById(payload.shopId, payload.teamId);
  if (!shop) {
    return NextResponse.json({ error: '门店不存在或无权限' }, { status: 404 });
  }

  const adapter = getPlatformAdapter(shop.platform);
  const redirectUri = `${getBaseUrl()}/api/ecommerce/oauth/callback`;

  try {
    const credentials = await adapter.handleAuthCallback({ code, redirectUri });

    // OAuth 回调无用户会话，仅能提供 state 还原出的 teamId。
    await withTenantContext(payload.teamId, null, async (tx) => {
      await tx
        .update(shops)
        .set({
          accessToken: credentials.accessToken,
          refreshToken: credentials.refreshToken ?? null,
          tokenExpiresAt: credentials.tokenExpiresAt ?? null,
          externalShopId: credentials.externalShopId ?? null,
          syncStatus: 'connected',
          updatedAt: new Date(),
        })
        .where(eq(shops.id, shop.id));
    });

    // 跳回门店管理页（成功）
    return NextResponse.redirect(
      `${getBaseUrl()}/dashboard/ecommerce/shops?connected=1`
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}