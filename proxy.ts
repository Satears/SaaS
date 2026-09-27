import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { signToken, verifyToken } from '@/lib/auth/session';

/**
 * Next 的 proxy 约定（替代已被标记 deprecated 的 middleware.ts）。
 * 职责：1) 受保护路由的登录态校验；2) 刷新会话；3) 注入 nonce 型 CSP。
 */

const protectedRoutes = ['/dashboard', '/admin'];

function generateNonce() {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}

function buildCsp(nonce: string) {
  const isDev = process.env.NODE_ENV !== 'production';
  return [
    `default-src 'self'`,
    // Next 会把该 nonce 注入到自身的 <script> 标签上
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''}`,
    // Tailwind / Next 会注入内联样式，样式层暂无法使用 nonce
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'self'`,
    `upgrade-insecure-requests`
  ].join('; ');
}

function applyCsp<T extends NextResponse>(response: T, csp: string): T {
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get('session');
  const isProtectedRoute = protectedRoutes.some((r) => pathname.startsWith(r));

  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  if (isProtectedRoute && !sessionCookie) {
    return applyCsp(
      NextResponse.redirect(new URL('/sign-in', request.url)),
      csp
    );
  }

  // nonce 必须同时放在「请求头」上：Next 只会从请求头的 CSP 中读取 nonce，
  // 再注入到运行时生成的 <script> 标签上。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const res = applyCsp(
    NextResponse.next({ request: { headers: requestHeaders } }),
    csp
  );

  if (sessionCookie && request.method === 'GET') {
    try {
      const parsed = await verifyToken(sessionCookie.value);
      const expiresInOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);

      res.cookies.set({
        name: 'session',
        value: await signToken({
          ...parsed,
          expires: expiresInOneDay.toISOString()
        }),
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        expires: expiresInOneDay
      });
    } catch (error) {
      console.error('Error updating session:', error);
      res.cookies.delete('session');
      if (isProtectedRoute) {
        return applyCsp(
          NextResponse.redirect(new URL('/sign-in', request.url)),
          csp
        );
      }
    }
  }

  return res;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
  runtime: 'nodejs'
};