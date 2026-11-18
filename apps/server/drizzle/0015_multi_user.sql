CREATE TABLE "agent_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"issuer" text,
	"scopes" text,
	"link_by_email" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"token_hash" text NOT NULL,
	"code_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"secret" text,
	"target" text,
	"confirmed_at" bigint,
	"last_step" bigint,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"builtin" text,
	"permissions" jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"require_mfa" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint
);
--> statement-breakpoint
CREATE TABLE "user_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'auto' NOT NULL,
	"approval_mode" text,
	"tool_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP CONSTRAINT "mcp_servers_name_unique";--> statement-breakpoint
ALTER TABLE "skills" DROP CONSTRAINT "skills_name_unique";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "everyone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "visibility" text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "restriction" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "verified_at" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO "roles" ("id", "name", "description", "builtin", "permissions", "limits", "require_mfa", "created_at", "updated_at") VALUES
	('role_admin', 'Admin', 'Everything: server settings, users and roles, every feature, no limits.', 'admin', '["admin"]', '{}', false, (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),
	('role_member', 'Member', 'Their own bots and chats, with the features this role allows.', 'member', '["bots","web","browser","routines","library","voice","compare"]', '{}', false, (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role_id" text;--> statement-breakpoint
-- Everyone who was here before roles existed set the server up: they're admins.
UPDATE "users" SET "role_id" = 'role_admin';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
-- Data from before accounts existed but no account: an owner to hold it (set its password with bun run reset-password).
INSERT INTO "users" ("id", "username", "email", "name", "role_id", "password_hash", "password_changed_at", "created_at", "updated_at")
SELECT 'usr_owner', 'owner', NULL, 'Owner', 'role_admin', NULL, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM "users") AND EXISTS (SELECT 1 FROM "agents");--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" bigint;--> statement-breakpoint
-- Everything that already exists belongs to the first account.
UPDATE "agents" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "conversations" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "documents" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "mcp_servers" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "memories" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "notes" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "routines" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "runs" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "usage_log" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "activity_log" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "uploads" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "skills" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1) WHERE "user_id" IS NULL AND NOT "builtin";--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "routines" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
-- Bots' pictures are shown to whoever they're shared with.
UPDATE "uploads" SET "visibility" = 'users' WHERE "id" IN (SELECT substring("avatar"->>'url' from 'upl_[A-Za-z0-9]+') FROM "agents" WHERE "avatar"->>'kind' = 'image');--> statement-breakpoint
-- Personal settings move from the server's settings to the first account's.
INSERT INTO "user_prefs" ("user_id", "timezone", "approval_mode", "tool_rules", "data", "updated_at")
SELECT u."id",
	coalesce((SELECT "value"->>'timezone' FROM "settings" WHERE "key" = 'app'), 'auto'),
	(SELECT "value"->>'approvalMode' FROM "settings" WHERE "key" = 'app'),
	coalesce((SELECT "value"->'toolRules' FROM "settings" WHERE "key" = 'app'), '{}'::jsonb),
	jsonb_strip_nulls(jsonb_build_object(
		'digest', (SELECT "value" FROM "settings" WHERE "key" = 'digest.config'),
		'digestLastSentAt', (SELECT "value" FROM "settings" WHERE "key" = 'digest.lastSentAt'),
		'checkups', (SELECT "value" FROM "settings" WHERE "key" = 'memory.checkups'),
		'push', (SELECT "value" FROM "settings" WHERE "key" = 'push.subscriptions')
	)),
	(extract(epoch from now()) * 1000)::bigint
FROM "users" u WHERE u."id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1);--> statement-breakpoint
DELETE FROM "settings" WHERE "key" IN ('digest.config', 'digest.lastSentAt', 'memory.checkups', 'push.subscriptions');--> statement-breakpoint
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tickets" ADD CONSTRAINT "auth_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_provider_id_auth_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."auth_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_prefs" ADD CONSTRAINT "user_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_shares_agent_idx" ON "agent_shares" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_shares_target_idx" ON "agent_shares" USING btree ("kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tickets_token_idx" ON "auth_tickets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tickets_user_idx" ON "auth_tickets" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "mfa_factors_user_idx" ON "mfa_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recovery_codes_user_idx" ON "recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_subject_idx" ON "user_identities" USING btree ("provider_id","subject");--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_user_idx" ON "activity_log" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "documents_user_idx" ON "documents" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_servers_owner_name_idx" ON "mcp_servers" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "memories_user_idx" ON "memories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notes_user_idx" ON "notes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "routines_user_idx" ON "routines" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "runs_user_idx" ON "runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_owner_name_idx" ON "skills" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_builtin_name_idx" ON "skills" USING btree ("name") WHERE "skills"."user_id" is null;--> statement-breakpoint
CREATE INDEX "usage_log_user_idx" ON "usage_log" USING btree ("user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");