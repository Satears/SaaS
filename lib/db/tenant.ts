import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import { client } from './drizzle';
import * as schema from './schema';

/**
 * 租户上下文注入 —— 让数据库级 RLS（0009_rls_context.sql 修订后的策略）真正生效。
 *
 * 工作原理：
 *   RLS 策略依赖两个会话变量：
 *     `app.team_id` —— 当前租户，策略据此约束 team_id 列
 *     `app.user_id` —— 当前用户，用于放行「本人所属」的 teams / team_members 行
 *                       （登录与注册阶段尚不知道 team_id，只能靠它，见 docs/RLS.md 第八节）
 *   postgres-js 使用连接池，会话级 `SET` 会跨请求污染，因此必须用事务包裹 +
 *   `set_config(..., is_local => true)`（事务结束自动回滚，不泄漏到连接池中的其他请求）。
 *
 * 用法：
 *   await withTenantContext(teamId, userId, async (tx) => {
 *     return tx.select().from(products);   // 仅返回该 team 的行
 *   });
 *
 * 注意：
 *   - 一次调用 = 一个事务。请把「同一业务动作的多个查询」放进同一次调用，
 *     而不是每个查询各包一层，否则每个查询都会退化成独立事务，增加往返开销。
 *   - 不要在已处于事务中时调用本函数（postgres-js 不支持嵌套 begin）。
 */

export type TenantTx = ReturnType<typeof drizzle<typeof schema>>;

/**
 * 在指定租户/用户上下文内执行一段事务。
 *
 * @param teamId 当前租户 ID；为 null 时不设置（适用于尚未确定租户的流程）
 * @param userId 当前用户 ID；为 null 时不设置
 * @param fn     事务回调，参数为绑定到事务连接的 drizzle 实例
 */
export async function withTenantContext<T>(
  teamId: number | null,
  userId: number | null,
  fn: (tx: TenantTx) => Promise<T>
): Promise<T> {
  const result = await client.begin(async (sql) => {
    if (teamId !== null) {
      await sql`SELECT set_config('app.team_id', ${String(teamId)}, true)`;
    }
    if (userId !== null) {
      await sql`SELECT set_config('app.user_id', ${String(userId)}, true)`;
    }
    // 用事务句柄重建 drizzle 实例，保证后续查询走同一连接
    const txDb = drizzle(sql, { schema });
    return fn(txDb);
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
