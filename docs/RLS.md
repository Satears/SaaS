# 行级安全（RLS）接入说明

本项目采用 **应用层 team_id 过滤 + 数据库级 RLS 纵深防御** 的双层租户隔离。

- 应用层：所有查询通过 `requireTenant` / `requireTenantApi` 守卫 + 手动 `where team_id`（现有实现）
- 数据库层：`0006_rls_policies.sql` 启用 RLS，即使某条查询漏写 `where team_id`，也会被数据库自动拦截

---

## 〇、当前状态（务必先读）

`0006_rls_policies.sql` 同时对租户表执行了 `ENABLE` **和** `FORCE ROW LEVEL SECURITY`。
`FORCE` 会让**表 owner 也受策略约束**，而应用是用 owner 账号（`POSTGRES_URL`）直连的，
于是策略里的 `WITH CHECK (team_id = app_current_team_id())` 变成硬约束；但应用侧
从未设置过 `app.team_id`（`withTenantContext()` 只有定义、没有调用方），因此：

- 注册（`INSERT INTO teams` / `team_members`）直接失败：
  `new row violates row-level security policy for table "teams"`（SQLSTATE `42501`，routine `ExecWithCheckOptions`）
- 所有 RLS 表的 `SELECT` 因 `app.team_id` 为空而**静默返回空集**（仪表盘拿不到 team）

`0007_rls_disable_force.sql` 的处置是：**保留 RLS（ENABLE + 策略），仅去掉 `FORCE`**，
让应用连接账号（表 owner）绕过策略，RLS 仍对其他角色生效。

> 也就是说：**当前 RLS 是「已铺设但未真正约束业务请求」的纵深防御骨架**。
> 只有在完成「第三节步骤 2 + 步骤 3」（改用非 owner 角色连接，并把
> `withTenantContext` 接进所有租户查询）之后，才可以把 `FORCE` 加回来。

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
| `app_user`（默认连接用户） | 仅当前租户 | 普通业务请求 |
| `app_admin` | 跨租户读 | 平台管理后台统计 |
| `app_service`（`BYPASSRLS`） | 完全绕过 RLS | seed / 迁移 / webhook |

---

## 三、启用方式（渐进式，推荐）

> ⚠️ **不要直接在生产库一键 FORCE RLS**。启用前必须确认所有「尚未确定 team_id」的流程（登录、注册、webhook）已用 `withServiceRole` 或管理员角色包裹，否则会立即 403。

### 步骤 1：执行迁移

```bash
pnpm db:migrate   # 执行 0006_rls_policies.sql
```

### 步骤 2：确认连接用户

`POSTGRES_URL` 的连接用户若为 **superuser 或表 owner**，RLS 默认对其**不生效**（Postgres 语义）。要真正启用 RLS，需让业务请求以受限角色连接：

```sql
-- 创建受限应用角色（与 app_user 对应，NOLOGIN 由中间层 SET ROLE）
CREATE ROLE app_user NOLOGIN;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- ⚠️ 只有在这一步（应用改用 app_user 连接、且 withTenantContext 已接线）完成后，
--    才可以把 FORCE 加回来；否则会重现第〇节的注册 500。
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;
```

### 步骤 3：应用层接线

把租户数据表的查询迁移到 `withTenantContext`：

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
