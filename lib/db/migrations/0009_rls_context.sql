-- ============================================================================
-- 0009 RLS 上下文与策略修订（本迁移不启用 RLS）
--
-- 目的：让「启用 RLS」成为一次安全的、可分批的操作。本迁移只做准备：
--   1. 新增会话变量 app.user_id 的读取函数；
--   2. 修订 teams / team_members 的策略，使其支持「本人所属」语义，
--      从而消除登录与注册的死锁（详见 docs/RLS.md）；
--   3. 清除 FORCE ROW LEVEL SECURITY —— FORCE 会让表 owner 同样受策略约束，
--      导致 owner 身份的 SECURITY DEFINER 函数也无法绕过 RLS，
--      使「特权路径」方案失效；
--   4. 新增用于 webhook 跨租户定位的 SECURITY DEFINER 函数。
--
-- 启用 RLS 的语句单独放在 0010_rls_enable.sql，需按环境分批执行。
--
-- 背景（为什么需要 app.user_id）：
--   登录时需要「先读 team_members 才能得知 team_id」，但 team_members 本身
--   受 RLS 约束且此刻尚无 team_id —— 典型鸡生蛋问题。引入 app.user_id 后，
--   策略可放行「属于当前用户」的行，登录不再需要任何特权路径。
--   注册时同理：新建的 team 尚无 id，策略放行 app.user_id 非空时的 INSERT。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 会话变量读取函数
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::integer;
$$;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 2. teams 策略：本租户 / 本人所属 / 平台管理员
--    本人所属通过 team_members 子查询判定；team_members 的策略不反向引用
--    teams，因此不会产生策略递归。
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "teams_tenant_isolation" ON "teams";
--> statement-breakpoint
CREATE POLICY "teams_tenant_isolation" ON "teams"
  USING (
    id = app_current_team_id()
    OR app_is_admin()
    OR EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = teams.id
        AND tm.user_id = app_current_user_id()
    )
  )
  WITH CHECK (
    id = app_current_team_id()
    OR app_current_user_id() IS NOT NULL
  );
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 3. team_members 策略：本租户 / 本人所属 / 平台管理员
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "team_members_tenant_isolation" ON "team_members";
--> statement-breakpoint
CREATE POLICY "team_members_tenant_isolation" ON "team_members"
  USING (
    team_id = app_current_team_id()
    OR user_id = app_current_user_id()
    OR app_is_admin()
  )
  WITH CHECK (
    team_id = app_current_team_id()
    OR user_id = app_current_user_id()
  );
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 4. 清除 FORCE ROW LEVEL SECURITY
--    FORCE 的语义是「表 owner 也受策略约束」。本项目应用连接角色 app_runtime
--    本就不是 owner，FORCE 对它没有任何额外保护；反而会让 owner 身份的
--    SECURITY DEFINER 函数（特权路径）一并被 RLS 拦下，失去意义。
--    因此这里统一清除，RLS 对 app_runtime 的保护不受影响。
-- ----------------------------------------------------------------------------
ALTER TABLE "teams" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "team_members" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_projects" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shops" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "products" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "orders" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_contents" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_keys" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_records" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge_entries" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "service_sessions" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "service_messages" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_ledger" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "activity_logs" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitations" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 5. 特权路径：Stripe webhook 按 customerId 跨租户定位 team
--    webhook 来自 Stripe，没有用户会话，无法提供 app.user_id / app.team_id，
--    因此必须以表 owner 身份执行（SECURITY DEFINER）。
--    安全加固：固定 search_path，且只授权给 app_runtime，不给 PUBLIC。
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_find_team_by_stripe_customer(customer_id text)
RETURNS SETOF public.teams
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT * FROM public.teams WHERE stripe_customer_id = customer_id;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app_find_team_by_stripe_customer(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_find_team_by_stripe_customer(text) TO app_runtime;
