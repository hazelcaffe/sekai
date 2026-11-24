ALTER TABLE "providers" ADD COLUMN "sign_in_command" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "own_config" boolean DEFAULT false NOT NULL;