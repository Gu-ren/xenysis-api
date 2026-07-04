CREATE TABLE IF NOT EXISTS "workspace_waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"startup_id" uuid NOT NULL,
	"startup_name" text NOT NULL,
	"founder_stage" text DEFAULT 'building' NOT NULL,
	"blueprint_id" uuid,
	"email" text NOT NULL,
	"source" text DEFAULT 'workspace_generation' NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_waitlist_status_check" CHECK ("workspace_waitlist"."status" IN ('waiting', 'notified', 'activated')),
	CONSTRAINT "workspace_waitlist_founder_stage_check" CHECK ("workspace_waitlist"."founder_stage" IN ('idea', 'building', 'revenue'))
);
--> statement-breakpoint
ALTER TABLE IF EXISTS "deploy_environments" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE IF EXISTS "releases" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP TABLE IF EXISTS "deploy_env_vars" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "deploy_environments" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "releases" CASCADE;
--> statement-breakpoint
ALTER TABLE "founder_sessions" ADD COLUMN IF NOT EXISTS "founder_stage" text DEFAULT 'building' NOT NULL;
--> statement-breakpoint
ALTER TABLE "founder_sessions" ADD COLUMN IF NOT EXISTS "marketplace_detected" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "founder_understanding" ADD COLUMN IF NOT EXISTS "marketplace_detected" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "founder_understanding" ADD COLUMN IF NOT EXISTS "supply_side_confidence" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workspace_waitlist" ADD CONSTRAINT "workspace_waitlist_startup_id_startups_id_fk"
    FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "founder_understanding" ADD CONSTRAINT "supply_side_confidence_range"
    CHECK ("founder_understanding"."supply_side_confidence" BETWEEN 0 AND 100);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."environment_name";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."release_status";
