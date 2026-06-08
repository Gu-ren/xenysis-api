CREATE TABLE "evidence_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"startup_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"evidence" text NOT NULL,
	"evidence_strength" integer DEFAULT 1 NOT NULL,
	"source_message_id" text,
	"confidence_impact" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founder_understanding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"startup_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_confidence" integer DEFAULT 0 NOT NULL,
	"customer_confidence" integer DEFAULT 0 NOT NULL,
	"solution_confidence" integer DEFAULT 0 NOT NULL,
	"market_confidence" integer DEFAULT 0 NOT NULL,
	"pricing_confidence" integer DEFAULT 0 NOT NULL,
	"competition_confidence" integer DEFAULT 0 NOT NULL,
	"risks_confidence" integer DEFAULT 0 NOT NULL,
	"founder_fit_confidence" integer DEFAULT 0 NOT NULL,
	"overall_confidence" integer DEFAULT 0 NOT NULL,
	"overall_evidence_strength" integer DEFAULT 1 NOT NULL,
	"is_complete" boolean DEFAULT false NOT NULL,
	"weakest_category" text,
	"understanding" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_understanding_session" UNIQUE("session_id"),
	CONSTRAINT "problem_confidence_range" CHECK ("founder_understanding"."problem_confidence"     BETWEEN 0 AND 100),
	CONSTRAINT "customer_confidence_range" CHECK ("founder_understanding"."customer_confidence"    BETWEEN 0 AND 100),
	CONSTRAINT "solution_confidence_range" CHECK ("founder_understanding"."solution_confidence"    BETWEEN 0 AND 100),
	CONSTRAINT "market_confidence_range" CHECK ("founder_understanding"."market_confidence"      BETWEEN 0 AND 100),
	CONSTRAINT "pricing_confidence_range" CHECK ("founder_understanding"."pricing_confidence"     BETWEEN 0 AND 100),
	CONSTRAINT "competition_confidence_range" CHECK ("founder_understanding"."competition_confidence" BETWEEN 0 AND 100),
	CONSTRAINT "risks_confidence_range" CHECK ("founder_understanding"."risks_confidence"       BETWEEN 0 AND 100),
	CONSTRAINT "founder_fit_confidence_range" CHECK ("founder_understanding"."founder_fit_confidence"  BETWEEN 0 AND 100),
	CONSTRAINT "overall_confidence_range" CHECK ("founder_understanding"."overall_confidence"     BETWEEN 0 AND 100),
	CONSTRAINT "overall_evidence_strength_range" CHECK ("founder_understanding"."overall_evidence_strength" BETWEEN 1 AND 6)
);
--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_session_id_founder_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."founder_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_understanding" ADD CONSTRAINT "founder_understanding_session_id_founder_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."founder_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_understanding" ADD CONSTRAINT "founder_understanding_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE no action ON UPDATE no action;