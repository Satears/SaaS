-- ============================================================================
-- 0012 注册建店的特权函数（本迁移不启用 RLS，可在任何环境安全执行）
--
-- 为什么需要它：
--   `teams` 的 RLS 策略 USING 要求「本租户 或 本人已是该团队成员 或 平台管理员」。
--   但注册时新建的 team 尚无 id（app.team_id 为空），成员关系也还没写入
--   （user_id 尚未与 team_id 关联），三个条件全部不成立。
--
--   关键点：PostgreSQL 在 `INSERT ... RETURNING` 时，除 WITH CHECK 外**还会对
--   返回的行套用 SELECT 策略（USING）**。因此直接
--       INSERT INTO teams (...) VALUES (...) RETURNING id
--   会抛：new row violates row-level security policy for table "teams"（42501）——
--   正是启用 RLS 后注册失败、也即上次生产故障的根因。
--   （已实测：同一条 INSERT 去掉 RETURNING 即成功，加上即 42501。）
--
-- 做法：以表 owner 身份（SECURITY DEFINER）原子地插入 team 与 owner 成员关系，
--       并返回新 team id，从两侧策略旁路。
--
-- 安全边界：仅授权 app_runtime；调用方必须传入当前登录用户自己的 id。
-- ============================================================================

CREATE OR REPLACE FUNCTION app_create_team_with_owner(
  p_user_id integer,
  p_name varchar,
  p_slug varchar DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_team_id integer;
BEGIN
  INSERT INTO public.teams (name, slug)
  VALUES (p_name, p_slug)
  RETURNING id INTO v_team_id;

  INSERT INTO public.team_members (user_id, team_id, role)
  VALUES (p_user_id, v_team_id, 'owner');

  RETURN v_team_id;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app_create_team_with_owner(integer, varchar, varchar) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_create_team_with_owner(integer, varchar, varchar) TO app_runtime;
