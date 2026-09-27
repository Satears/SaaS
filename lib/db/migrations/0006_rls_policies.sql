-- ============================================================================
-- 0006 行级安全（Row-Level Security, RLS）
--
-- 目标：在应用层 team_id 过滤之上，增加数据库级纵深防御。
-- 一旦某条查询遗漏 WHERE team_id，RLS 会自动拦截，杜绝跨租户数据泄漏。
--
-- 工作机制：
--   1. 应用层在建立连接/事务时通过 `SET app.team_id = '<id>'` 声明当前租户。
--   2. 每张含 team_id 的表启用 RLS，策略要求：
--        team_id = current_setting('app.team_id', true)::int
--   3. 平台管理员 / 后台任务 / seed 脚本通过切换角色绕过 RLS。
--
-- 角色设计：
--   app_user       普通应用角色（受 RLS 约束，默认）
--   app_admin      平台管理员（可跨租户读，仍受写约束）
--   app_service    服务角色（完全绕过 RLS：seed / 迁移 / 后台任务）
--
-- 注意：本迁移只做「启用 + 策略 + 角色」三件事，不改变现有表结构。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 角色（幂等：已存在则跳过）
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    CREATE ROLE app_service NOLOGIN BYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO app_admin, app_service;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_admin, app_service;
--> statement-breakpoint
-- 后续新建表也自动授权
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_admin, app_service;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 2. 辅助函数：解析当前租户 ID（未设置时返回 NULL，策略据此拒绝）
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_team_id() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.team_id', true), '')::integer;
$$;
--> statement-breakpoint

-- 平台管理员判断：是否以 app_admin / app_service 角色运行
CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (current_user = 'app_admin' OR current_user = 'app_service');
$$;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 3. 为所有含 team_id 的表启用 RLS 并挂策略
--    策略规则（写操作）：team_id = app_current_team_id()
--    平台管理员读操作：可跨租户（用于管理后台统计）
-- ----------------------------------------------------------------------------

-- 租户表自身：仅允许访问当前租户行（或管理员）
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "teams_tenant_isolation" ON "teams";
--> statement-breakpoint
CREATE POLICY "teams_tenant_isolation" ON "teams"
  USING (id = app_current_team_id() OR app_is_admin())
  WITH CHECK (id = app_current_team_id());
--> statement-breakpoint
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- team_members
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "team_members_tenant_isolation" ON "team_members";
--> statement-breakpoint
CREATE POLICY "team_members_tenant_isolation" ON "team_members"
  USING (team_id = app_current_team_id() OR app_is_admin())
  WITH CHECK (team_id = app_current_team_id());
--> statement-breakpoint
ALTER TABLE "team_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ai_projects
ALTER TABLE "ai_projects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "ai_projects_tenant_isolation" ON "ai_projects";
--> statement-breakpoint
CREATE POLICY "ai_projects_tenant_isolation" ON "ai_projects"
  USING (team_id = app_current_team_id() OR app_is_admin())
  WITH CHECK (team_id = app_current_team_id());
--> statement-breakpoint
ALTER TABLE "ai_projects" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- shops
ALTER TABLE "shops" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "shops_tenant_isolation" ON "shops";
--> statement-breakpoint
CREATE POLICY "shops_tenant_isolation" ON "shops"
  USING (team_id = app_current_team_id() OR app_is_admin())
  WITH CHECK (team_id = app_current_team_id());
--> statement-breakpoint
ALTER TABLE "shops" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- products
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "products_tenant_isolation" ON "products";
--> statement-breakpoint
CREATE POLICY "products_tenant_isolation" ON "products"
  USING (team_id = app_current_team_id() OR app_is_admin())
  WITH CHECK (team_id = app_current_team_id());
--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- orders
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "orders_tenant_isolation" ON "orders";
--> statement-breakpoint
CREATE POLICY "orders_tenant_isolation" ON "orders"
  USING (team_id = app_current_team_id() OR app_is_admin())
  WITH CHECK (team_id = app_current_team_id());
--> statement-breakpoint
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ai_contents
ALTER TABLE "ai_contents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "ai_contents_tenant_isolation" ON "ai_contents";
--> statement-breakpoint
CREATE POLICY "ai_contents_tenant_isolation" ON "ai_contents"
  USING (team_id = app_current_team_id() OR app_is_admin())
  WITH CHECK (team_id = app_current_team_id());
--> statement-breakpoint
ALTER TABLE "ai_contents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- api_keys
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "api_keys_tenant_isolation" ON "api_keys";
--> statement-breakpoint
CREATE POLICY "api_keys_tenant_isolation" ON "api_keys"
  USING (team_id = app_current_team_id() OR app_is_admin())
  WITH CHECK (team_id = app_current_team_id());
--> statement-breakpoint
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- usage_records
ALTER TABLE "usage_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "usage_records_tenant_isolation" ON "usage_records";
--> statement-breakpoint
CREATE POLICY "usage_records_tenant_isolation" ON "usage_records"
  USING (team_id = app_current_team_id() OR app_is_admin())
  WITH CHECK (team_id = app_current_team_id());
--> statement-breakpoint
ALTER TABLE "usage_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- knowledge_entries
ALTER TABLE "knowledge_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "knowledge_entries_tenant_isolation" ON "knowledge_entries";
--> statement-breakpoint
CREATE POLICY "knowledge_entries_tenant_isolation" ON "knowledge_entries"
  USING (team_id = app_current_team_id() OR app_is_admin())
  WITH CHECK (team_id = app_current_team_id());
--> statement-breakpoint
ALTER TABLE "knowledge_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- service_sessions
ALTER TABLE "service_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "service_sessions_tenant_isolation" ON "service_sessions";
--> statement-breakpoint
CREATE POLICY "service_sessions_tenant_isolation" ON "service_sessions"
  USING (team_id = app_current_team_id() OR app_is_admin())
  WITH CHECK (team_id = app_current_team_id());
--> statement-breakpoint
ALTER TABLE "service_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- service_messages（无 team_id，通过 session_id 间接隔离；保留为开放表，由上层 join 约束）
-- 说明：service_messages 通过 service_sessions.team_id 间接归属，RLS 策略需子查询。
ALTER TABLE "service_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "service_messages_tenant_isolation" ON "service_messages";
--> statement-breakpoint
CREATE POLICY "service_messages_tenant_isolation" ON "service_messages"
  USING (
    app_is_admin()
    OR EXISTS (
      SELECT 1 FROM "service_sessions" s
      WHERE s.id = "service_messages".session_id
        AND s.team_id = app_current_team_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "service_sessions" s
      WHERE s.id = "service_messages".session_id
        AND s.team_id = app_current_team_id()
    )
  );
--> statement-breakpoint
ALTER TABLE "service_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- billing_ledger
ALTER TABLE "billing_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "billing_ledger_tenant_isolation" ON "billing_ledger";
--> statement-breakpoint
CREATE POLICY "billing_ledger_tenant_isolation" ON "billing_ledger"
  USING (team_id = app_current_team_id() OR app_is_admin())
  WITH CHECK (team_id = app_current_team_id());
--> statement-breakpoint
ALTER TABLE "billing_ledger" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- activity_logs
ALTER TABLE "activity_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "activity_logs_tenant_isolation" ON "activity_logs";
--> statement-breakpoint
CREATE POLICY "activity_logs_tenant_isolation" ON "activity_logs"
  USING (team_id = app_current_team_id() OR app_is_admin())
  WITH CHECK (team_id = app_current_team_id());
--> statement-breakpoint
ALTER TABLE "activity_logs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- invitations
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "invitations_tenant_isolation" ON "invitations";
--> statement-breakpoint
CREATE POLICY "invitations_tenant_isolation" ON "invitations"
  USING (team_id = app_current_team_id() OR app_is_admin())
  WITH CHECK (team_id = app_current_team_id());
--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
