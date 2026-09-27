import { getUser, getTeamForUser, getMembershipForUser } from '@/lib/db/queries';
import { redirect } from 'next/navigation';
import { type User, type Team } from '@/lib/db/schema';

export type TenantRole = 'owner' | 'admin' | 'member';

/**
 * 租户上下文：当前登录用户及其团队/角色。
 */
export type TenantContext = {
  user: User | null;
  team: Team | null;
  role: TenantRole | null;
};

/**
 * 已认证的租户上下文（user 与 team 均非空）。
 */
export type AuthenticatedTenantContext = {
  user: User;
  team: Team;
  role: TenantRole | null;
};

/**
 * 获取当前租户上下文（不抛错，返回 null 表示未认证）。
 */
export async function getTenantContext(): Promise<TenantContext> {
  const user = await getUser();
  if (!user) {
    return { user: null, team: null, role: null };
  }
  const team = await getTeamForUser();
  const role = await getMembershipForUser(user.id);
  return { user, team, role };
}

/**
 * 要求已登录且属于某租户；否则重定向到登录页（用于 Server Component / Action）。
 */
export async function requireTenant(): Promise<AuthenticatedTenantContext> {
  const ctx = await getTenantContext();
  if (!ctx.user || !ctx.team) {
    redirect('/sign-in');
  }
  return { user: ctx.user, team: ctx.team, role: ctx.role };
}

/**
 * API 路由版租户守卫：未认证返回 null（不重定向），由调用方决定响应。
 */
export async function requireTenantApi(): Promise<AuthenticatedTenantContext | null> {
  const ctx = await getTenantContext();
  if (!ctx.user || !ctx.team) {
    return null;
  }
  return { user: ctx.user, team: ctx.team, role: ctx.role };
}

/**
 * API 路由版平台管理员守卫：非管理员返回 null。
 */
export async function requirePlatformAdminApi() {
  const user = await getUser();
  if (!user || user.platformRole !== 'admin') {
    return null;
  }
  return user;
}

/**
 * 要求租户内角色满足最低权限（owner > admin > member）。
 */
export function requireRole(
  ctx: AuthenticatedTenantContext,
  minRole: TenantRole
) {
  const rank: Record<TenantRole, number> = { member: 1, admin: 2, owner: 3 };
  const current = ctx.role ?? 'member';
  if (rank[current] < rank[minRole]) {
    throw new Error('Forbidden: insufficient tenant permissions');
  }
}

/**
 * 要求平台级管理员。用于管理后台 /admin 路由。
 */
export async function requirePlatformAdmin() {
  const user = await getUser();
  if (!user) {
    redirect('/sign-in');
  }
  if (user.platformRole !== 'admin') {
    redirect('/dashboard');
  }
  return user;
}
