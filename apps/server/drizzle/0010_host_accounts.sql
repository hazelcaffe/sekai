ALTER TABLE "access_grants" ADD COLUMN "account" text;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "accounts" jsonb DEFAULT '[]'::jsonb NOT NULL;