CREATE TABLE "activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" bigint NOT NULL,
	"agent_id" text,
	"conversation_id" text,
	"message_id" text,
	"run_id" text,
	"tool_call_id" text NOT NULL,
	"tool" text NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"risk" text,
	"status" text NOT NULL,
	"decision" text,
	"decided_by" text,
	"note" text,
	"args" jsonb NOT NULL,
	"result" text,
	"error" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE INDEX "activity_log_at_idx" ON "activity_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "activity_log_agent_idx" ON "activity_log" USING btree ("agent_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_log_call_idx" ON "activity_log" USING btree ("message_id","tool_call_id");--> statement-breakpoint
-- What bots did so far, from the tool calls in their messages.
INSERT INTO "activity_log" ("id", "at", "agent_id", "conversation_id", "message_id", "run_id", "tool_call_id", "tool", "title", "source", "risk", "status", "decision", "decided_by", "note", "args", "result", "error", "duration_ms")
SELECT 'act_' || substr(md5(m."id" || (p->>'id')), 1, 20),
	coalesce((p->>'endedAt')::bigint, (p->>'startedAt')::bigint, m."created_at"),
	m."agent_id", m."conversation_id", m."id", m."run_id", p->>'id', coalesce(p->>'name', 'tool'),
	coalesce(nullif(p->>'title', ''), p->>'name', 'tool'), coalesce(p->>'source', 'builtin'), p->>'risk', p->>'status',
	p->'approval'->>'decision', p->'approval'->>'by', p->'approval'->>'note',
	CASE WHEN length(coalesce(p->'args', '{}'::jsonb)::text) > 4000 THEN jsonb_build_object('shortened', left((p->'args')::text, 4000)) ELSE coalesce(p->'args', '{}'::jsonb) END,
	left(p->>'result', 2000), left(p->>'error', 2000),
	CASE WHEN p ? 'endedAt' AND p ? 'startedAt' THEN least(((p->>'endedAt')::bigint - (p->>'startedAt')::bigint), 2147483647)::int END
FROM "messages" m, jsonb_array_elements(m."parts") AS p
WHERE p->>'type' = 'tool' AND p->>'status' IN ('done', 'error', 'denied') AND p ? 'id'
ON CONFLICT DO NOTHING;
