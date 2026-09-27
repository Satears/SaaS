-- ============================================================================
-- 0007 修正 RLS：去掉 FORCE ROW LEVEL SECURITY
--
-- 背景（生产故障复盘）：
--   0006 对含 team_id 的表同时执行了 ENABLE 与 FORCE ROW LEVEL SECURITY。
--   FORCE 会让**表 owner 也受策略约束**，而应用是用 owner 账号（POSTGRES_URL）
--   直连的，于是策略里的 `WITH CHECK (team_id = app_current_team_id())` 成为硬约束。
--
--   但应用侧从未设置过 `app.team_id`（withTenantContext() 只有定义、无调用），
--   且注册流程本身就是「新建 team」——此时还没有 team_id，校验必然失败：
--
--     new row violates row-level security policy for table "teams"
--     code: 42501  routine: ExecWithCheckOptions
--
--   表现为注册 500（digest 184638613），且所有 RLS 表的 SELECT 会静默返回空集
--   （teams / team_members / shops / products / orders ...），登录后仪表盘全空。
--
-- 本迁移的处置：
--   保留 RLS（ENABLE + 策略），仅去掉 FORCE，使应用连接账号（表 owner）绕过策略，
--   RLS 仍对其他角色生效，纵深防御的骨架与文档设计不受影响。
--
--   若将来要让 RLS 真正约束应用请求，需先完成两件事（见 docs/RLS.md）：
--     1. 以非 owner 角色（如 app_user）连接，并把 withTenantContext() 接进所有租户查询；
--     2. 让注册/登录/webhook 等「尚无 team_id」的流程走 service 角色，
--        且在策略中引用 app.bypass_rls 或改用 app_is_admin() 之类的角色判断。
-- ============================================================================

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