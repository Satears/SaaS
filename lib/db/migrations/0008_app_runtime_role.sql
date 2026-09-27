-- ============================================================================
-- 0008 应用运行时角色与授权
--
-- 背景：各环境的 POSTGRES_URL 以受限角色 `app_runtime` 连接（非 owner、非
-- superuser、NOBYPASSRLS）。此前该角色只在生产库手工创建过，导致「执行完
-- 0000~0007 建出的新库」缺少这个角色与其表权限——把 POSTGRES_URL 指过去会
-- 直接连不上或无权访问。
--
-- 本迁移把「建角色 + 授权」纳入标准迁移流程，让新库（本地、Preview、灾备）
-- 用 `pnpm db:migrate` 即可得到可用的受限角色。
--
-- 安全说明：本迁移不设置任何密码。密码属于环境机密，请按环境单独执行
--   ALTER ROLE app_runtime PASSWORD '<per-env-secret>';
-- 不要把它写进版本库。
-- ============================================================================

-- 角色（幂等：已存在则跳过）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
--> statement-breakpoint

-- 后续新建的表/序列也自动授权，避免新增迁移后忘记补权限
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
