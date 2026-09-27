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

---

## 七、应用层隔离审查（2026-09-27）

由于 RLS 处于关闭状态，应用层 `team_id` 过滤是**唯一防线**，因此对全部直接数据库访问点
（9 个文件、20 处 `db.select/insert/update/delete`）做了逐条复核，并修复以下缺口：

| 位置 | 问题 | 处置 |
|---|---|---|
| `app/api/ecommerce/products/route.ts` | 请求体 `shopId` 未校验归属，可把商品挂到他人门店 | 写入前 `getShopById(shopId, teamId)` 校验 |
| `app/api/ecommerce/products/import/route.ts` | 同上（批量导入） | 同上 |
| `app/api/ai/scenes/route.ts` | `shopId` 直接写入 `ai_contents` | 同上 |
| `app/api/ai/service/route.ts` | `shopId` 直接写入 `service_sessions` | 同上 |
| `app/api/ecommerce/sync/route.ts` | `shops` 的三处状态更新仅按主键 | 补 `eq(shops.teamId, ctx.team.id)` |
| `lib/ai/knowledge.ts` | `getSessionMessages` / `appendMessage` 未校验会话归属；`updateKnowledge` 允许传入 `teamId` | 读写前校验 `getSession(sessionId, teamId)`；更新收敛为字段白名单类型 `KnowledgeUpdate` |
| `lib/db/queries.ts` | `getMembershipForUser` / `getTeamForUser` 无 `teamId` 作用域且无排序，多团队用户可能取到其它团队角色 | 增加可选 `teamId` 参数与 `ORDER BY team_members.id` 确定性排序；`rbac.getTenantContext` 现在按 `team.id` 取角色 |

复核方式：`npx tsc --noEmit` + `next build` 通过；`next start` 实跑确认
未登录访问 `/dashboard` 返回 307 → `/sign-in`，且 CSP 已下发、内联脚本带 nonce。

> 这仍属于「应用层兜底」，无法防御绕过应用直接连库的路径。重新打开 RLS 的前置条件
> 与第三节步骤 2、3 完全一致，未发生变化。

---

## 八、启用 RLS 的新方案（2026-09-27 起，以此为准）

> ⚠️ 第一至七节描述的是**旧方案**，其中两条说法已作废，见下。

### 8.1 旧方案中被作废的说法

| 旧说法 | 实际情况 |
|---|---|
| 「`withServiceRole()` 可绕过 RLS」 | **无效实现**。它设置 `app.bypass_rls`，但 `app_is_admin()` 判断的是 `current_user`，两者对不上。该函数若无调用方则等同死代码 |
| 「不建议使用 `FORCE ROW LEVEL SECURITY`」 | 结论正确，但原因需补充：`FORCE` 会让**表 owner 也受策略约束**，从而使 owner 身份的 `SECURITY DEFINER` 函数一并被拦下，**特权路径方案会失效**。`0009` 已统一清除 FORCE |

### 8.2 核心设计

引入第二个会话变量 **`app.user_id`**，与 `app.team_id` 配合，解决两类死锁：

| 死锁 | 原因 | 解法 |
|---|---|---|
| 登录 | 要先读 `team_members` 才知道 `team_id`，但该表受 RLS 约束且此刻无 `team_id` | `team_members` 策略放行 `user_id = app.user_id` 的行 |
| 注册 | `WITH CHECK (team_id = app_current_team_id())` 在新建 team 尚无 id 时必然失败（**上次生产 500 的根因**） | `teams` 的 `WITH CHECK` 放行 `app.user_id` 非空时的 INSERT |

由此，**登录与注册都不再需要特权路径**。仅剩两处必须绕过的流程，以 `SECURITY DEFINER` 函数实现（owner 身份执行，固定 `search_path`，仅授权 `app_runtime`）：

- `app_find_team_by_stripe_customer(text)` —— Stripe webhook 无用户会话，需按 customerId 跨租户定位 team
- 平台后台跨租户统计 —— **尚未实现**，需要时按同样方式补一个函数

### 8.3 已完成：`0009_rls_context.sql`

只做前置准备，**不启用 RLS**，因此可在任何环境安全执行：

1. 新增 `app_current_user_id()`
2. 修订 `teams` / `team_members` 策略（本租户 OR 本人所属 OR 平台管理员）
3. 清除 15 张表的 `FORCE ROW LEVEL SECURITY`
4. 新增 `app_find_team_by_stripe_customer()` 特权函数

**实测结论**（临时库中手动启用 RLS，并以 `app_runtime` 真实连接断言，13/13 通过）：

```
无上下文查询 products/teams  → 0 行（默认拒绝）
app.team_id=1 查询            → 仅见本租户行
app.team_id=1 跨租户写入      → 被拒 42501
app.team_id=1 本租户写入      → 成功
app.user_id=1 查询            → 见本人成员行与所属 team
SECURITY DEFINER 跨租户定位   → 成功
```

### 8.4 尚未完成（启用 RLS 前必须做）

1. **应用层接线**：`withTenantContext(teamId, userId, fn)` 需要同时设置 `app.team_id` 与 `app.user_id`；目前该函数**零调用方**，约 20 处租户查询需要逐一包进事务。
2. **注册流程**：创建 user 后的建 team / 建 membership 必须放进设置了 `app.user_id` 的事务。
3. **webhook**：改用 `app_find_team_by_stripe_customer()` 替代现有的跨租户查询。
4. **平台后台统计**：需补一个 `SECURITY DEFINER` 聚合函数，否则 `/admin` 会被 RLS 拦成空数据。
5. **删除或修复 `withServiceRole()`**：当前是无效实现。
6. **启用步骤本身**：写成独立迁移（如 `0010_rls_enable.sql`），**先只在 Preview 库执行并跑通全链路，确认无 42501 与空集后再上生产**。在该迁移被登记进 `meta/_journal.json` 之前，`pnpm db:migrate` **不会**启用 RLS —— 这是刻意留出的安全闸门。

