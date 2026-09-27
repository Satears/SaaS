import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import { client } from './drizzle';
import * as schema from './schema';

/**
 * 租户上下文注入 —— 让数据库级 RLS（0006_rls_policies.sql）真正生效。
 *
 * 工作原理：
 *   PostgreSQL RLS 策略依赖会话变量 `app.team_id`。
 *   postgres-js 使用连接池，会话级 `SET` 会跨请求污染，因此必须用
 *   事务包裹 + `set_config(..., is_local => true)`（事务结束自动回滚，
 *   不泄漏到连接池中的其他请求）。
 *
 * 用法：
 *   await withTenantContext(teamId, async (tx) => {
 *     // tx 内的所有查询都受 RLS 约束在 teamId 范围内
 *     return tx.select().from(products);
 *   });
 *
 * 说明：
 *   - 当前项目的查询大多在应用层已手动带 `where team_id`，
 *     RLS 是纵深防御的第二道闸门，而非唯一防线。
 *   - 登录/注册/webhook 等「尚未确定 team_id」的流程，需要以
 *     管理员/服务角色绕过（见下方 withServiceRole）。
 */

/**
 * 在指定租户上下文内执行一段事务。
 * 事务内的所有查询自动满足 RLS 的 team_id 约束。
 *
 * @param teamId 当前租户 ID
 * @param fn      事务回调，参数为绑定到事务连接的 drizzle 实例
 */
export async function withTenantContext<T>(
  teamId: number,
  fn: (tx: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>
): Promise<T> {
  const result = await client.begin(async (sql) => {
    // 事务内设置会话变量（局部，事务结束自动清除）
    await sql`SELECT set_config('app.team_id', ${String(teamId)}, true)`;
    // 用事务句柄重建 drizzle 实例，保证后续查询走同一连接
    const txDb = drizzle(sql, { schema });
    return fn(txDb);
  });
  return result as unknown as T;
}

/**
 * 以服务角色执行（绕过 RLS）。用于：
 *   - seed / 迁移脚本
 *   - Stripe webhook（按 customerId 跨租户定位 team）
 *   - 平台管理后台的跨租户统计
 *
 * 前提：应用以 app_service 角色连接，或连接用户是表 owner（默认 superuser）。
 * 若连接用户为 superuser/owner，RLS 本就不会拦截，此函数退化为普通事务。
 */
export async function withServiceRole<T>(fn: () => Promise<T>): Promise<T> {
  const result = await client.begin(async (sql) => {
    await sql`SELECT set_config('app.bypass_rls', 'on', true)`;
    return fn();
  });
  return result as unknown as T;
}

/**
 * 判断 RLS 是否已启用（用于运行时安全提示）。
 * 若 RLS 未启用且应用层 team_id 过滤也缺失，属于高危状态。
 */
export async function isRlsEnabled(): Promise<boolean> {
  const rows = await client`
    SELECT relrowsecurity AS enabled
    FROM pg_class
    WHERE relname = 'teams'
  `;
  return rows.length > 0 && rows[0].enabled === true;
}
