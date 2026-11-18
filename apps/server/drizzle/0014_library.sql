CREATE TABLE "document_chunks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"ord" integer NOT NULL,
	"page" integer,
	"heading" text,
	"content" text NOT NULL,
	"embedding" vector,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(heading, '') || ' ' || content)) STORED
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"collection" text DEFAULT '' NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"upload_id" text,
	"status" text NOT NULL,
	"error" text,
	"pages" integer,
	"chunks" integer DEFAULT 0 NOT NULL,
	"chars" integer DEFAULT 0 NOT NULL,
	"embedding_model" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_chunks_doc_idx" ON "document_chunks" USING btree ("document_id","ord");--> statement-breakpoint
CREATE INDEX "document_chunks_tsv_idx" ON "document_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "documents_collection_idx" ON "documents" USING btree ("collection");