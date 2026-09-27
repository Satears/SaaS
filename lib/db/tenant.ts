import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from './drizzle';

/**
 * 租户上下文注入 —— 让数据库级 RLS（0009_rls_context.sql 修订后的策略）真正生效。
 *
 * 工作原理：
 *   RLS 策略依赖两个会话变量：
 *     `app.team_id` —— 当前租户，策略据此约束 team_id 列
 *     `app.user_id` —— 当前用户，放行「本人所属」的 teams / team_members 行
 *                       （登录与注册阶段尚不知道 team_id，只能靠它，见 docs/RLS.md 第八节）
 *   两个变量都用 `set_config(..., is_local => true)` 在事务内设置，事务结束自动清除，
 *   不会泄漏到连接池中的其他请求。
 *
 * ⚠️ 为什么用 `db.transaction()` 而不是 `client.begin()` + `drizzle(txHandle)`：
 *   后者会在运行时报 `TypeError: Cannot read properties of undefined (reading 'parsers')`
 *   —— drizzle 的 postgres-js 适配器需要读取 `client.options.parsers`，而
 *   `client.begin()` 回调拿到的事务句柄不具备该结构。
 *   改用 drizzle 自己的 `db.transaction()`，回调里就是标准 drizzle 事务实例。
 *
 * 用法：
 *   await withTenantContext(teamId, userId, async (tx) => {
 *     return tx.select().from(products);   // 仅返回该 team 的行
 *   });
 *
 * 注意：
 *   - 一次调用 = 一个事务。请把「同一业务动作的多个查询」放进同一次调用，
 *     而不是每个查询各包一层，否则每个查询都会退化成独立事务。
 *   - postgres-js 不支持嵌套事务。调用方若已持有 tx，请直接复用该 tx
 *     （见 lib/db/queries.ts 的 runWithContext），不要再次调用本函数。
 */

/** 事务句柄类型：从 db.transaction 的回调参数推导，避免手工维护类型。 */
export type TenantTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  return db.transaction(async (tx) => {
    if (teamId !== null) {
      await tx.execute(sql`select set_config('app.team_id', ${String(teamId)}, true)`);
    }
    if (userId !== null) {
      await tx.execute(sql`select set_config('app.user_id', ${String(userId)}, true)`);
    }
    return fn(tx);
  });
}

/**
 * 判断 RLS 是否已启用（用于运行时安全提示）。
 */
export async function isRlsEnabled(): Promise<boolean> {
  const rows = (await db.execute(
    sql`select relrowsecurity as enabled from pg_class where relname = 'teams'`
  )) as unknown as { enabled: boolean }[];
  return rows.length > 0 && rows[0].enabled === true;
}
