CREATE TABLE "agent_keys" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"status_detail" text,
	"specs" jsonb NOT NULL,
	"hostname" text NOT NULL,
	"username" text NOT NULL,
	"addresses" jsonb NOT NULL,
	"ports" jsonb NOT NULL,
	"remote_id" text,
	"secrets" text NOT NULL,
	"expires_at" bigint,
	"created_by" text NOT NULL,
	"last_used_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_logins" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"site" text NOT NULL,
	"username" text NOT NULL,
	"secret" text NOT NULL,
	"last_used_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_logins" ADD CONSTRAINT "saved_logins_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "machines_agent_idx" ON "machines" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_logins_site_idx" ON "saved_logins" USING btree ("agent_id","site","username");