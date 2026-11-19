CREATE TABLE "machine_members" (
	"id" text PRIMARY KEY NOT NULL,
	"machine_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"username" text NOT NULL,
	"display" integer,
	"vnc_port" integer,
	"cdp_port" integer,
	"status" text NOT NULL,
	"status_detail" text,
	"secrets" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_browser_members" (
	"browser_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"port" integer,
	"created_at" bigint NOT NULL,
	CONSTRAINT "shared_browser_members_browser_id_agent_id_pk" PRIMARY KEY("browser_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "shared_browsers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"machine_id" text,
	"sign_ins" text NOT NULL,
	"share_with_viewers" boolean DEFAULT false NOT NULL,
	"port" integer,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "share_with_viewers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "machine_members" ADD CONSTRAINT "machine_members_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_members" ADD CONSTRAINT "machine_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_browser_members" ADD CONSTRAINT "shared_browser_members_browser_id_shared_browsers_id_fk" FOREIGN KEY ("browser_id") REFERENCES "public"."shared_browsers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_browser_members" ADD CONSTRAINT "shared_browser_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_browsers" ADD CONSTRAINT "shared_browsers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_browsers" ADD CONSTRAINT "shared_browsers_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "machine_members_seat_idx" ON "machine_members" USING btree ("machine_id","agent_id");--> statement-breakpoint
CREATE INDEX "machine_members_agent_idx" ON "machine_members" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "shared_browser_members_agent_idx" ON "shared_browser_members" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "shared_browsers_user_idx" ON "shared_browsers" USING btree ("user_id");