-- ============================================================================
-- 0007 关闭 RLS：撤销 0006 的强制启用（生产故障修复）
--
-- ⚠️ 必须在 **表 owner 角色**（生产库为 neondb_owner）下执行。
--    应用连接角色 app_runtime 不是 owner，执行会报 "must be owner of table"。
--    在 Neon SQL Editor 里执行即可（控制台默认就是 owner 角色）。
--
-- 背景（生产故障复盘）：
--   0006 对 15 张含 team_id 的表执行了 ENABLE + FORCE ROW LEVEL SECURITY。
--   生产库的实际角色配置是：
--     - 表 owner：neondb_owner
--     - 应用连接角色：app_runtime（非 superuser、非 owner、非 BYPASSRLS）
--   于是 RLS 对 app_runtime 真实生效，而应用侧从未设置过 app.team_id
--   （withTenantContext() 只有定义、没有调用方），结果是：
--
--     new row violates row-level security policy for table "teams"
--     code: 42501  routine: ExecWithCheckOptions  (digest 184638613)
--
--   - 注册写入 teams / team_members 直接失败 → 注册 500
--   - 其余 RLS 表的 SELECT 因 app.team_id 为空返回空集 → 登录后仪表盘全空
--
--   注意：单纯去掉 FORCE **无法解决**本故障。FORCE 只决定「表 owner 是否受
--   策略约束」；app_runtime 并非 owner，无论有没有 FORCE 都受策略约束。
--
-- 本迁移的处置：
--   关闭这 15 张表的 RLS，让应用恢复「仅由应用层 team_id 过滤」的隔离模式
--   （即 requireTenant / requireTenantApi + 手动 where team_id，这是项目当前
--   真实生效的防线）。
--
--   策略定义（*_tenant_isolation）保留不动，RLS 关闭时它们不生效；
--   将来要把 RLS 真正跑起来，需要先完成（见 docs/RLS.md）：
--     1. 由 owner 调整策略，使注册/登录等「尚无 team_id」的写入不被拦截；
--     2. 把 withTenantContext() 接进所有租户查询；
--     3. 再显式 ENABLE ROW LEVEL SECURITY。
--   —— 在此之前不要重新开启，否则会重现本次故障。
-- ============================================================================

-- 租户核心表：注册流程直接写入，必须放行
ALTER TABLE "teams" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "team_members" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_projects" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shops" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "products" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "orders" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_contents" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_keys" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_records" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge_entries" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "service_sessions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "service_messages" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_ledger" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "activity_logs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitations" DISABLE ROW LEVEL SECURITY;