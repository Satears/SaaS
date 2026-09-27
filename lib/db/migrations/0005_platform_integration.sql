-- 店铺平台接入字段（OAuth 凭证 + 同步状态）
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "access_token" text;
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "refresh_token" text;
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "token_expires_at" timestamp;
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "external_shop_id" varchar(100);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "sync_status" varchar(20) NOT NULL DEFAULT 'disconnected';
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp;
