-- ============================================================================
-- 0011 启用 RLS
--
-- ⚠️ 本文件刻意 **不登记** 进 meta/_journal.json。
--    因此 `pnpm db:migrate` 不会执行它，RLS 不会被自动打开。
--    这是留出的安全闸门：启用必须是一次显式、可分批、可回滚的操作。
--
-- 启用前提（缺一不可，见 docs/RLS.md 第八节）：
--   1. 0008~0010 已应用到目标库（角色 / 策略 / 特权函数就绪）
--   2. 应用层已接入 withTenantContext（设置 app.team_id 与 app.user_id）
--   3. 已在**独立的分支库**上跑通全链路：注册 → 登录 → 建门店 → AI 调用 → Stripe webhook，
--      确认没有 42501（RLS 违规）与静默空集
--
-- 启用方式（逐环境、按顺序）：
--   在目标库执行本文件全部语句。
--
-- 回滚（一条命令即可，RLS 是纯叠加层，不影响应用层 team_id 过滤）：
--   ALTER TABLE "teams" DISABLE ROW LEVEL SECURITY;
--   ...依次对所有表执行，或直接复用 0007_rls_disable.sql
--
-- 注意：不要加 FORCE ROW LEVEL SECURITY。FORCE 会让表 owner 同样受策略约束，
--       导致 owner 身份的 SECURITY DEFINER 特权函数（0010）被一并拦下而失效。
-- ============================================================================

ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_projects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shops" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_contents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "service_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "service_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "activity_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
