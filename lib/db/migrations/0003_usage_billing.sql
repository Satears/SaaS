-- 账单明细表：超额用量按量计费
CREATE TABLE IF NOT EXISTS "billing_ledger" (
  "id" serial PRIMARY KEY NOT NULL,
  "team_id" integer NOT NULL REFERENCES "teams"("id"),
  "period" varchar(7) NOT NULL,
  "kind" varchar(30) NOT NULL,
  "description" text,
  "overage_tokens" integer NOT NULL DEFAULT 0,
  "overage_calls" integer NOT NULL DEFAULT 0,
  "amount_cents" integer NOT NULL DEFAULT 0,
  "currency" varchar(3) NOT NULL DEFAULT 'usd',
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "stripe_invoice_id" varchar(100),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_ledger_team_period_idx" ON "billing_ledger" ("team_id", "period");
