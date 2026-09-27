import 'server-only';
import { SignJWT, jwtVerify } from 'jose';

/**
 * 门店接入 OAuth 的 state 签名与校验。
 *
 * state 以签名 JWT 承载 shopId + teamId，回调时验签并还原归属，
 * 防止攻击者篡改 state 把授权凭证写到其他团队的门店上。
 */
const key = new TextEncoder().encode(process.env.AUTH_SECRET);
const STATE_TTL = '10m';

export async function signOAuthState(payload: {
  shopId: number;
  teamId: number;
}): Promise<string> {
  return await new SignJWT({ shopId: payload.shopId, teamId: payload.teamId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(STATE_TTL)
    .sign(key);
}

/**
 * 校验 state 签名；非法、过期或载荷不完整时返回 null。
 */
export async function verifyOAuthState(
  state: string
): Promise<{ shopId: number; teamId: number } | null> {
  try {
    const { payload } = await jwtVerify(state, key, {
      algorithms: ['HS256'],
    });
    const shopId = Number(payload.shopId);
    const teamId = Number(payload.teamId);
    if (!Number.isInteger(shopId) || !Number.isInteger(teamId)) {
      return null;
    }
    return { shopId, teamId };
  } catch {
    return null;
  }
}