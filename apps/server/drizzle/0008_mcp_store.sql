ALTER TABLE "mcp_servers" ADD COLUMN "scope" text DEFAULT 'agents' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "catalog_id" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "oauth" text;