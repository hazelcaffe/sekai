CREATE TABLE "usage_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" bigint NOT NULL,
	"agent_id" text,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"run_id" text
);
--> statement-breakpoint
CREATE INDEX "usage_log_at_idx" ON "usage_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "usage_log_agent_idx" ON "usage_log" USING btree ("agent_id","at");--> statement-breakpoint
-- What replies used so far (from their runs), so the stats start with history.
INSERT INTO "usage_log" ("id", "at", "agent_id", "purpose", "model", "input_tokens", "output_tokens", "reasoning_tokens", "cached_tokens", "run_id")
SELECT 'use_' || "id", coalesce("finished_at", "created_at"), "agent_id", 'reply', coalesce("model", 'unknown'),
	coalesce(("usage"->>'inputTokens')::int, 0), coalesce(("usage"->>'outputTokens')::int, 0),
	coalesce(("usage"->>'reasoningTokens')::int, 0), coalesce(("usage"->>'cachedTokens')::int, 0), "id"
FROM "runs" WHERE "usage" IS NOT NULL;
