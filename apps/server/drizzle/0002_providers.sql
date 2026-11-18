CREATE TABLE "external_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"token" text NOT NULL,
	"session_id" text,
	"synced_at" bigint,
	"prompt_hashes" jsonb,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" text PRIMARY KEY NOT NULL,
	"preset" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"command" text NOT NULL,
	"args" jsonb NOT NULL,
	"env" jsonb NOT NULL,
	"extra_models" jsonb NOT NULL,
	"status" jsonb,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_sessions" ADD CONSTRAINT "external_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_sessions" ADD CONSTRAINT "external_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_sessions" ADD CONSTRAINT "external_sessions_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_sessions_key_idx" ON "external_sessions" USING btree ("agent_id","conversation_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_sessions_token_idx" ON "external_sessions" USING btree ("token");