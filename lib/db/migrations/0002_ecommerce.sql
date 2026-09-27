-- 0002 电商运营数据模型 + 套餐场景化扩展

-- 扩展 plans：电商场景配额与功能开关
ALTER TABLE "plans" ADD COLUMN "quota_shops" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "quota_products" integer DEFAULT 50 NOT NULL;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "quota_copies_monthly" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "quota_campaigns_monthly" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "quota_service_sessions_monthly" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "feature_copywriting" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "feature_marketing" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "feature_customer_service" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "feature_analytics" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- 更新既有计划的功能开关与场景配额
UPDATE "plans" SET
  "quota_shops" = 1, "quota_products" = 10, "quota_copies_monthly" = 20,
  "quota_campaigns_monthly" = 5, "quota_service_sessions_monthly" = 10,
  "feature_copywriting" = true, "feature_marketing" = false,
  "feature_customer_service" = false, "feature_analytics" = false
WHERE "tier" = 'free';
--> statement-breakpoint
UPDATE "plans" SET
  "quota_shops" = 3, "quota_products" = 200, "quota_copies_monthly" = 500,
  "quota_campaigns_monthly" = 100, "quota_service_sessions_monthly" = 500,
  "feature_copywriting" = true, "feature_marketing" = true,
  "feature_customer_service" = true, "feature_analytics" = true
WHERE "tier" = 'pro';
--> statement-breakpoint
UPDATE "plans" SET
  "quota_shops" = 10, "quota_products" = 2000, "quota_copies_monthly" = 5000,
  "quota_campaigns_monthly" = 1000, "quota_service_sessions_monthly" = 5000,
  "feature_copywriting" = true, "feature_marketing" = true,
  "feature_customer_service" = true, "feature_analytics" = true
WHERE "tier" = 'business';
--> statement-breakpoint
UPDATE "plans" SET
  "quota_shops" = 100, "quota_products" = 50000, "quota_copies_monthly" = 100000,
  "quota_campaigns_monthly" = 20000, "quota_service_sessions_monthly" = 100000,
  "feature_copywriting" = true, "feature_marketing" = true,
  "feature_customer_service" = true, "feature_analytics" = true
WHERE "tier" = 'enterprise';
--> statement-breakpoint

-- 电商店铺
CREATE TABLE IF NOT EXISTS "shops" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"platform" varchar(30) DEFAULT 'shopify' NOT NULL,
	"domain" varchar(200),
	"category" varchar(100),
	"currency" varchar(10) DEFAULT 'CNY' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint

-- 商品
CREATE TABLE IF NOT EXISTS "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"shop_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"category" varchar(100),
	"price" numeric(12,2),
	"sku" varchar(100),
	"images" jsonb,
	"attributes" jsonb,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint

-- 订单
CREATE TABLE IF NOT EXISTS "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"shop_id" integer NOT NULL,
	"product_id" integer,
	"order_no" varchar(100),
	"amount" numeric(12,2),
	"quantity" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'paid' NOT NULL,
	"customer_id" varchar(100),
	"ordered_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- AI 生成内容记录
CREATE TABLE IF NOT EXISTS "ai_contents" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"shop_id" integer,
	"product_id" integer,
	"scene" varchar(30) NOT NULL,
	"input" text,
	"output" text NOT NULL,
	"model" varchar(100),
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "shops" ADD CONSTRAINT "shops_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "products" ADD CONSTRAINT "products_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_contents" ADD CONSTRAINT "ai_contents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_contents" ADD CONSTRAINT "ai_contents_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_contents" ADD CONSTRAINT "ai_contents_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
