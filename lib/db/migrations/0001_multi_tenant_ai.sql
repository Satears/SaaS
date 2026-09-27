-- 0001 多租户 + 配额 + AI 资源扩展
CREATE TYPE "public"."user_role" AS ENUM ('admin', 'user');
--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM ('owner', 'admin', 'member');
--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM ('free', 'pro', 'business', 'enterprise');
--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM ('inactive', 'active', 'trialing', 'past_due', 'canceled', 'unpaid');
--> statement-breakpoint

-- 迁移 users.role -> platform_role
ALTER TABLE "users" ADD COLUMN "platform_role" "user_role" DEFAULT 'user' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";
--> statement-breakpoint

-- 迁移 team_members.role 为枚举（字符串值兼容）
ALTER TABLE "team_members" ALTER COLUMN "role" TYPE "member_role" USING "role"::"member_role";
--> statement-breakpoint

-- teams 新增租户字段
ALTER TABLE "teams" ADD COLUMN "slug" varchar(100);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "plan_tier" "plan_tier" DEFAULT 'free' NOT NULL;
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "custom_quota" jsonb;
--> statement-breakpoint
-- 将原 varchar 的 subscription_status 转换为枚举
UPDATE "teams" SET "subscription_status" = 'inactive' WHERE "subscription_status" IS NULL;
--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "subscription_status" TYPE "subscription_status" USING "subscription_status"::"subscription_status";
--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "subscription_status" SET DEFAULT 'inactive';
--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "subscription_status" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_slug_unique" ON "teams" ("slug");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"tier" "plan_tier" NOT NULL,
	"description" text,
	"stripe_price_id" text,
	"price_monthly_cents" integer DEFAULT 0 NOT NULL,
	"quota_token_monthly" bigint DEFAULT 0 NOT NULL,
	"quota_projects" integer DEFAULT 1 NOT NULL,
	"quota_members" integer DEFAULT 1 NOT NULL,
	"quota_api_calls_daily" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plans_tier_unique" UNIQUE("tier")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"model" varchar(100) DEFAULT 'gpt-4o-mini' NOT NULL,
	"system_prompt" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"key_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "usage_records" (
	"id" bigint PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer,
	"api_key_id" integer,
	"kind" varchar(30) NOT NULL,
	"model" varchar(100),
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "ai_projects" ADD CONSTRAINT "ai_projects_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_project_id_ai_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ai_projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 默认订阅计划种子
INSERT INTO "plans" ("name", "tier", "description", "price_monthly_cents", "quota_token_monthly", "quota_projects", "quota_members", "quota_api_calls_daily")
VALUES
  ('Free', 'free', '免费体验版', 0, 50000, 1, 1, 100),
  ('Pro', 'pro', '专业版', 1200, 1000000, 10, 5, 5000),
  ('Business', 'business', '商业版', 4900, 10000000, 50, 20, 50000),
  ('Enterprise', 'enterprise', '企业版', 19900, 100000000, 200, 100, 500000)
ON CONFLICT ("tier") DO NOTHING;
