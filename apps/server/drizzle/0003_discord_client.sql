CREATE TABLE "channel_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"external_chat_id" text NOT NULL,
	"external_message_id" text NOT NULL,
	"message_id" text NOT NULL,
	"direction" text NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_bindings" ADD COLUMN "listen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_messages_external_idx" ON "channel_messages" USING btree ("external_chat_id","external_message_id");--> statement-breakpoint
CREATE INDEX "channel_messages_message_idx" ON "channel_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "channel_bindings_external_idx" ON "channel_bindings" USING btree ("external_chat_id");--> statement-breakpoint
DELETE FROM "channels" WHERE "type" <> 'discord';
