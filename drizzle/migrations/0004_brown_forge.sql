CREATE TYPE "public"."ai_provider" AS ENUM('openai', 'anthropic');--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "provider" "ai_provider" DEFAULT 'openai' NOT NULL;