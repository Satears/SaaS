# 行级安全（RLS）接入说明

本项目**设计上**采用 **应用层 team_id 过滤 + 数据库级 RLS 纵深防御** 的双层租户隔离。
其中数据库级 RLS **当前是关闭状态**（见第〇节），以下内容为 RLS 的设计与启用步骤。

- 应用层：所有查询通过 `requireTenant` / `requireTenantApi` 守卫 + 手动 `where team_id`（**当前唯一生效的防线**）
- 数据库层：`0006_rls_policies.sql` 定义了策略与角色；`0007_rls_disable.sql` 因生产故障关闭了 RLS

---

## 〇、当前状态（务必先读）

`0006_rls_policies.sql` 对 15 张含 `team_id` 的表执行了 `ENABLE` **和** `FORCE ROW LEVEL SECURITY`，
而生产库的角色配置是：

| 项 | 实际值 |
|---|---|
| 表 owner | `neondb_owner` |
| 应用连接角色（`POSTGRES_URL`） | `app_runtime`（非 superuser、非 owner、非 `BYPASSRLS`） |

`app_runtime` 并非表 owner，**无论有没有 `FORCE` 都受 RLS 策略约束**；而应用侧
从未设置过 `app.team_id`（`withTenantContext()` 只有定义、没有调用方），于是：

- 注册（`INSERT INTO teams` / `team_members`）直接失败：
  `new row violates row-level security policy for table "teams"`（SQLSTATE `42501`，routine `ExecWithCheckOptions`）
- 所有 RLS 表的 `SELECT` 因 `app.team_id` 为空而**静默返回空集**（登录后仪表盘拿不到 team）

`0007_rls_disable.sql` 的处置是：**关闭这 15 张表的 RLS**，恢复到项目当前真实生效的
「仅应用层 `team_id` 过滤」隔离模式。策略定义保留但不再生效。

> ⚠️ 两个常见误区：
> 1. **去掉 `FORCE` 解决不了本故障。** `FORCE` 只决定「表 owner 是否受策略约束」，
>    而 `app_runtime` 不是 owner。
> 2. **不要只 `DROP POLICY`。** RLS 处于 `ENABLE` 且无策略时是「默认全拒」，
>    比现在更糟；必须 `DISABLE ROW LEVEL SECURITY`。
>
> 反过来说：只有补齐「第三节步骤 2 + 步骤 3」（把 `withTenantContext` 接进所有租户查询，
> 并让注册/登录/webhook 等无 `team_id` 的流程走特权角色）之后，才可以把 RLS 重新打开。

---

## 一、工作机制

```
请求 → 中间件解析 JWT → 得到 userId → 查 team_members 得 teamId
                                        ↓
                        withTenantContext(teamId, ...)
                                        ↓
              SET LOCAL app.team_id = '<teamId>'（事务内）
                                        ↓
              SELECT ... FROM products  ← RLS 自动追加 team_id 约束
```

RLS 策略核心：

```sql
USING (team_id = app_current_team_id() OR app_is_admin())
WITH CHECK (team_id = app_current_team_id())
```

- `app_current_team_id()`：读取会话变量 `app.team_id`，未设置时返回 NULL → 拒绝
- `app_is_admin()`：`current_user` 为 `app_admin` / `app_service` 时放行（跨租户读）

---

## 二、角色设计

| 角色 | 能力 | 用途 |
|---|---|---|
| `app_runtime`（生产实际连接角色，**受限**） | 仅当前租户 | 普通业务请求 |
| `app_admin` | 跨租户读 | 平台管理后台统计 |
| `app_service`（`BYPASSRLS`） | 完全绕过 RLS | seed / 迁移 / webhook |

---

## 三、启用方式（渐进式，推荐）

> ⚠️ **不要在生产库直接开启 RLS**。启用前必须确认所有「尚未确定 team_id」的流程
> （登录、注册、webhook）已被放行，否则会立即出现 RLS 违规（`42501`）——注册直接 500，
> 其余查询静默返回空集。

### 步骤 1：执行迁移

`drizzle` 的 `meta/_journal.json` 只登记了 `0000`，`pnpm db:migrate` **不会**执行
`0001`–`0007`。这些 SQL 需要在数据库中以 **owner 角色**手工按序执行：

```bash
# 0001 → 0007 依次手工执行（Neon SQL Editor / psql -f）
```

### 步骤 2：确认连接用户

`POSTGRES_URL` 的连接用户若是 **superuser 或表 owner**，RLS 默认对其**不生效**（Postgres 语义）。
生产库当前用的是受限角色 `app_runtime`（非 owner），所以 RLS 确实会约束它 —— 这正是注册 500 的原因。

```sql
-- 生产库已存在受限角色 app_runtime（受限角色，无需 owner 也能被 RLS 约束）
-- 若需新建类似角色：
CREATE ROLE app_user NOLOGIN;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
```

> 不建议使用 `FORCE ROW LEVEL SECURITY`：它只决定「表 owner 是否也受策略约束」，
> 对已经受限的角色（`app_runtime`）没有任何额外作用，却会让「owner 本应绕过」的
> 调试手段失效。

### 步骤 3：应用层接线

把租户数据表的查询迁移到 `withTenantContext`（**当前尚未接线**）：

```ts
// lib/db/tenant.ts
import { withTenantContext } from '@/lib/db/tenant';

const products = await withTenantContext(ctx.team.id, (tx) =>
  tx.select().from(products).where(eq(products.shopId, shopId))
);
```

需要跨租户的流程用 `withServiceRole`：

```ts
import { withServiceRole } from '@/lib/db/tenant';

// Stripe webhook：按 customerId 跨租户定位 team
const team = await withServiceRole(() => getTeamByStripeCustomerId(customerId));
```

---

## 四、已知影响面（启用 RLS 前必须处理）

| 流程 | 查询的表 | 是否有 team_id 上下文 | 处理方式 |
|---|---|---|---|
| 登录 `signIn` | `users`, `team_members`, `teams` | ❌ 登录前无 | `withServiceRole` 或保持全局表不 FORCE |
| 注册 `signUp` | `users`, `teams`, `team_members` | ❌ 注册前无 | `withServiceRole` |
| Stripe webhook | `teams`（按 customerId） | ❌ 跨租户 | `withServiceRole` |
| 平台后台统计 | 全部表聚合 | ❌ 跨租户 | `app_admin` 角色 / `withServiceRole` |
| `users` / `plans` 表 | 全局表（无 team_id） | — | 不启用 RLS（本迁移未对其启用） |

> 本迁移**只对含 `team_id` 的租户数据表**启用 RLS，`users` / `plans` 等全局表不受影响。
> 但注意：`注册` 会向 `teams` / `team_members` 写入，这两张表**在 RLS 范围内**，
> 因此在 `withServiceRole` 真正可用之前，注册**会被中断**（见第〇节的生产故障复盘）。

---

## 五、`service_messages` 的特殊处理

`service_messages` 没有 `team_id` 字段，通过 `service_sessions.team_id` 间接归属。RLS 策略用 EXISTS 子查询间接约束：

```sql
USING (
  EXISTS (
    SELECT 1 FROM service_sessions s
    WHERE s.id = service_messages.session_id
      AND s.team_id = app_current_team_id()
  )
)
```

> 性能提示：高频查询建议在 `service_messages` 上冗余 `team_id` 列 + 复合索引，避免 EXISTS 子查询开销。

---

## 六、回滚

```sql
ALTER TABLE "teams" DISABLE ROW LEVEL SECURITY;
-- 依次对所有表执行 DISABLE，或直接 DROP POLICY
```

RLS 是**可随时开关的叠加层**，不影响应用层已有的 team_id 过滤逻辑，回滚无风险。
