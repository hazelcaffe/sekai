CREATE TABLE "api_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"preset" text NOT NULL,
	"kind" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key" text NOT NULL,
	"headers" jsonb NOT NULL,
	"discover" boolean NOT NULL,
	"models" jsonb NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
