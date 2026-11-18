CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "code_chunks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"index_id" text NOT NULL,
	"path" text NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"symbol" text,
	"content" text NOT NULL,
	"embedding" vector NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace(path || ' ' || content, '[^A-Za-z0-9]+', ' ', 'g'))) STORED
);
--> statement-breakpoint
CREATE TABLE "code_files" (
	"index_id" text NOT NULL,
	"path" text NOT NULL,
	"hash" text NOT NULL,
	"size" integer NOT NULL,
	"chunks" integer NOT NULL,
	CONSTRAINT "code_files_index_id_path_pk" PRIMARY KEY("index_id","path")
);
--> statement-breakpoint
CREATE TABLE "code_indexes" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"machine_id" text NOT NULL,
	"root" text NOT NULL,
	"name" text NOT NULL,
	"embedding_model" text NOT NULL,
	"dimensions" integer,
	"status" text NOT NULL,
	"progress" jsonb,
	"files" integer NOT NULL,
	"chunks" integer NOT NULL,
	"bytes" bigint NOT NULL,
	"error" text,
	"last_indexed_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "code_chunks" ADD CONSTRAINT "code_chunks_index_id_code_indexes_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."code_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_files" ADD CONSTRAINT "code_files_index_id_code_indexes_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."code_indexes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_indexes" ADD CONSTRAINT "code_indexes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_indexes" ADD CONSTRAINT "code_indexes_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "code_chunks_file_idx" ON "code_chunks" USING btree ("index_id","path");--> statement-breakpoint
CREATE INDEX "code_chunks_tsv_idx" ON "code_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "code_indexes_root_idx" ON "code_indexes" USING btree ("machine_id","root");--> statement-breakpoint
CREATE INDEX "code_indexes_agent_idx" ON "code_indexes" USING btree ("agent_id");