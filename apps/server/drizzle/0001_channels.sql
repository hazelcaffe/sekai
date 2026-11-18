CREATE TABLE "channel_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"external_chat_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"chat_name" text NOT NULL,
	"is_group" boolean NOT NULL,
	"last_inbound_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"secrets" jsonb NOT NULL,
	"dm_policy" text NOT NULL,
	"allow_from" jsonb NOT NULL,
	"group_policy" text NOT NULL,
	"delivery" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_bindings" ADD CONSTRAINT "channel_bindings_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_bindings" ADD CONSTRAINT "channel_bindings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_bindings_chat_idx" ON "channel_bindings" USING btree ("channel_id","external_chat_id");--> statement-breakpoint
CREATE INDEX "channel_bindings_conversation_idx" ON "channel_bindings" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "channels_agent_idx" ON "channels" USING btree ("agent_id");