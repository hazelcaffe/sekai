ALTER TABLE "messages" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_search_idx" ON "messages" USING gin (to_tsvector('simple', "search_text"));--> statement-breakpoint
-- Existing messages: their words, from their text parts.
UPDATE "messages" SET "search_text" = left(coalesce((SELECT string_agg(p->>'text', E'\n') FROM jsonb_array_elements("parts") AS p WHERE p->>'type' = 'text'), ''), 20000);
