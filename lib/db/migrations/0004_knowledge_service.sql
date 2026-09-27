-- 客服知识库（FAQ 问答对，向量化检索预留）
CREATE TABLE IF NOT EXISTS "knowledge_entries" (
  "id" serial PRIMARY KEY NOT NULL,
  "team_id" integer NOT NULL REFERENCES "teams"("id"),
  "shop_id" integer REFERENCES "shops"("id"),
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "category" varchar(100),
  "tags" jsonb,
  "embedding" jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_entries_team_idx" ON "knowledge_entries" ("team_id");

--> statement-breakpoint
-- 客服会话（多轮对话）
CREATE TABLE IF NOT EXISTS "service_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "team_id" integer NOT NULL REFERENCES "teams"("id"),
  "shop_id" integer REFERENCES "shops"("id"),
  "user_id" integer REFERENCES "users"("id"),
  "customer_name" varchar(100),
  "status" varchar(20) NOT NULL DEFAULT 'open',
  "language" varchar(10) NOT NULL DEFAULT 'zh',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_sessions_team_idx" ON "service_sessions" ("team_id");

--> statement-breakpoint
-- 客服会话消息
CREATE TABLE IF NOT EXISTS "service_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "session_id" integer NOT NULL REFERENCES "service_sessions"("id") ON DELETE CASCADE,
  "role" varchar(20) NOT NULL,
  "content" text NOT NULL,
  "tokens" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_messages_session_idx" ON "service_messages" ("session_id");
