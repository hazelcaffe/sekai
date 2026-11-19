ALTER TABLE "machines" ADD COLUMN "backend" text;--> statement-breakpoint
UPDATE "machines" SET "backend" = CASE WHEN "kind" = 'computer' THEN 'vm' ELSE 'lxc' END WHERE "provider" = 'proxmox';