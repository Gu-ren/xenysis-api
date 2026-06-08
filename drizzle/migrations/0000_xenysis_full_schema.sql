CREATE TYPE "public"."ai_purpose" AS ENUM('chat', 'opportunity_gen', 'blueprint_gen', 'workspace_gen', 'preview_gen');--> statement-breakpoint
CREATE TYPE "public"."environment_name" AS ENUM('production', 'staging', 'development');--> statement-breakpoint
CREATE TYPE "public"."generation_job_status" AS ENUM('pending', 'active', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."generation_job_type" AS ENUM('opportunity', 'blueprint', 'workspace', 'preview', 'full', 'founder_chat');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_stage" AS ENUM('founder-session', 'generating', 'preview', 'build', 'deployed');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('problem', 'customer', 'market', 'competition', 'revenue', 'team', 'vision', 'assumption');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('queued', 'in_progress', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."startup_category" AS ENUM('saas', 'marketplace', 'fintech', 'healthcare', 'ecommerce', 'developer-tool', 'ai-tool', 'social', 'other');--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "startups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "startup_category",
	"lifecycle_stage" "lifecycle_stage" DEFAULT 'founder-session' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "founder_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"startup_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"idea" text NOT NULL,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"messages_count" integer DEFAULT 0 NOT NULL,
	"session_duration_seconds" integer,
	"avg_message_length" integer,
	"completion_rate" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"question_type" "question_type" DEFAULT 'problem' NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sequence_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_max_length" CHECK (char_length("session_answers"."answer") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "founder_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"startup_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"memory" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "founder_memories_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "session_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"startup_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"exchange_count" integer NOT NULL,
	"source_message_count" integer,
	"summary_token_count" integer,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blueprint_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blueprint_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"generation_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blueprint_versions_blueprint_id_version_number_unique" UNIQUE("blueprint_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"startup_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"assessment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_assessment_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"generation_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_assessment_versions_assessment_id_version_number_unique" UNIQUE("assessment_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "opportunity_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"startup_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preview_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"startup_id" uuid NOT NULL,
	"workspace_version_id" uuid,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preview_contexts_startup_id_unique" UNIQUE("startup_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_asset_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_id" text NOT NULL,
	"status" text,
	"config" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_asset_configs_workspace_id_asset_id_unique" UNIQUE("workspace_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_graph_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"generation_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_graph_versions_workspace_id_version_number_unique" UNIQUE("workspace_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "workspace_graphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"startup_id" uuid NOT NULL,
	"blueprint_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_graphs_startup_id_unique" UNIQUE("startup_id")
);
--> statement-breakpoint
CREATE TABLE "ai_usage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"startup_id" uuid,
	"generation_job_id" uuid,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" numeric(10, 6) NOT NULL,
	"purpose" "ai_purpose" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"startup_id" uuid NOT NULL,
	"parent_job_id" uuid,
	"type" "generation_job_type" NOT NULL,
	"status" "generation_job_status" DEFAULT 'pending' NOT NULL,
	"artifact_id" uuid,
	"artifact_type" text,
	"prompt_version" text,
	"model" text DEFAULT 'claude-sonnet-4-6' NOT NULL,
	"idempotency_key" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_jobs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "progress_range" CHECK ("generation_jobs"."progress" >= 0 AND "generation_jobs"."progress" <= 100)
);
--> statement-breakpoint
CREATE TABLE "deploy_env_vars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deploy_env_vars_environment_id_key_unique" UNIQUE("environment_id","key")
);
--> statement-breakpoint
CREATE TABLE "deploy_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"startup_id" uuid NOT NULL,
	"name" "environment_name" NOT NULL,
	"branch" text,
	"region" text,
	"platform" text,
	"build_command" text,
	"output_dir" text,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deploy_environments_startup_id_name_unique" UNIQUE("startup_id","name")
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"version" text NOT NULL,
	"status" "release_status" DEFAULT 'queued' NOT NULL,
	"commit_sha" text,
	"triggered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"startup_id" uuid,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "founder_sessions" ADD CONSTRAINT "founder_sessions_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_answers" ADD CONSTRAINT "session_answers_session_id_founder_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."founder_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_memories" ADD CONSTRAINT "founder_memories_session_id_founder_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."founder_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_memories" ADD CONSTRAINT "founder_memories_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_summaries" ADD CONSTRAINT "session_summaries_session_id_founder_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."founder_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_summaries" ADD CONSTRAINT "session_summaries_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_versions" ADD CONSTRAINT "blueprint_versions_blueprint_id_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprints" ADD CONSTRAINT "blueprints_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprints" ADD CONSTRAINT "blueprints_session_id_founder_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."founder_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprints" ADD CONSTRAINT "blueprints_assessment_id_opportunity_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."opportunity_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_assessment_versions" ADD CONSTRAINT "opportunity_assessment_versions_assessment_id_opportunity_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."opportunity_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_assessments" ADD CONSTRAINT "opportunity_assessments_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_assessments" ADD CONSTRAINT "opportunity_assessments_session_id_founder_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."founder_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_contexts" ADD CONSTRAINT "preview_contexts_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_contexts" ADD CONSTRAINT "preview_contexts_workspace_version_id_workspace_graph_versions_id_fk" FOREIGN KEY ("workspace_version_id") REFERENCES "public"."workspace_graph_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_asset_configs" ADD CONSTRAINT "workspace_asset_configs_workspace_id_workspace_graphs_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace_graphs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_graph_versions" ADD CONSTRAINT "workspace_graph_versions_workspace_id_workspace_graphs_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace_graphs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_graphs" ADD CONSTRAINT "workspace_graphs_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_graphs" ADD CONSTRAINT "workspace_graphs_blueprint_id_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_env_vars" ADD CONSTRAINT "deploy_env_vars_environment_id_deploy_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."deploy_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_environments" ADD CONSTRAINT "deploy_environments_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_environment_id_deploy_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."deploy_environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_startup_id_startups_id_fk" FOREIGN KEY ("startup_id") REFERENCES "public"."startups"("id") ON DELETE no action ON UPDATE no action;