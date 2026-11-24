CREATE TABLE "email_accounts" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"mailcow_url" text,
	"imap" jsonb NOT NULL,
	"smtp" jsonb NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"allow_from" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signature" text DEFAULT '' NOT NULL,
	"notify_unknown" boolean DEFAULT true NOT NULL,
	"daily_limit" integer DEFAULT 50 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sync" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"direction" text NOT NULL,
	"message_id" text NOT NULL,
	"in_reply_to" text,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"sender" text NOT NULL,
	"verified_by" text,
	"automated" boolean DEFAULT false NOT NULL,
	"conversation_id" text,
	"started_chat" boolean DEFAULT false NOT NULL,
	"sekai_message_id" text,
	"folder" text,
	"uid" integer,
	"attachments" integer DEFAULT 0 NOT NULL,
	"note" text,
	"at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_messages_agent_idx" ON "email_messages" USING btree ("agent_id","at");--> statement-breakpoint
CREATE INDEX "email_messages_message_id_idx" ON "email_messages" USING btree ("agent_id","message_id");--> statement-breakpoint
CREATE INDEX "email_messages_conversation_idx" ON "email_messages" USING btree ("conversation_id");