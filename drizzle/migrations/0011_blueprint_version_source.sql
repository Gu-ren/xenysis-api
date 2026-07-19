ALTER TABLE "blueprint_versions" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'generate' NOT NULL;--> statement-breakpoint
ALTER TABLE "blueprint_versions" ADD COLUMN IF NOT EXISTS "note" text;
