-- ============================================================================
-- 0010 特权路径函数（本迁移不启用 RLS，可在任何环境安全执行）
--
-- 补上 0009 之外、RLS 启用后无法用 withTenantContext 覆盖的两处跨租户流程：
--   1. Stripe webhook：无用户会话，需按 customerId 跨租户定位 team
--   2. 平台后台统计：跨租户聚合
--
-- 设计取向：特权面尽可能小。
--   - 定位函数只返回 team id（不返回整行），调用方拿到 id 后立即回到
--     正常租户上下文读取，避免把跨租户读权限铺开。
--   - 聚合函数返回 camelCase 的 jsonb，使 TS 侧无需做 snake_case → camelCase 映射。
--   - 两个函数都固定 search_path，并 REVOKE FROM PUBLIC 后仅授权 app_runtime。
--
-- 注：0009 中的 app_find_team_by_stripe_customer(text) 返回整行、特权面偏大，
--     本迁移将其替换为只返回 id 的版本。
-- ============================================================================

DROP FUNCTION IF EXISTS app_find_team_by_stripe_customer(text);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_find_team_id_by_stripe_customer(customer_id text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT t.id FROM public.teams t WHERE t.stripe_customer_id = customer_id LIMIT 1;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_all_teams_with_stats()
RETURNS TABLE (team jsonb, member_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    jsonb_build_object(
      'id',                   t.id,
      'name',                 t.name,
      'slug',                 t.slug,
      'createdAt',            t.created_at,
      'updatedAt',            t.updated_at,
      'stripeCustomerId',     t.stripe_customer_id,
      'stripeSubscriptionId', t.stripe_subscription_id,
      'stripeProductId',      t.stripe_product_id,
      'planName',             t.plan_name,
      'planTier',             t.plan_tier,
      'subscriptionStatus',   t.subscription_status,
      'customQuota',          t.custom_quota
    ) AS team,
    COALESCE(
      (SELECT count(*) FROM public.team_members tm WHERE tm.team_id = t.id),
      0
    )::bigint AS member_count
  FROM public.teams t
  ORDER BY t.created_at DESC;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app_find_team_id_by_stripe_customer(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_all_teams_with_stats() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_find_team_id_by_stripe_customer(text) TO app_runtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_all_teams_with_stats() TO app_runtime;
