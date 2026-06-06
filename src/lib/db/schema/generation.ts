// TODO(sprint-3): Generation tracking tables
//
//   generation_jobs
//     Columns: id, user_id, startup_id, parent_job_id (self-ref),
//              type (generation_job_type enum), status, artifact_id, artifact_type,
//              prompt_version, model, idempotency_key (unique),
//              progress, stages (JSONB), error, attempt_number, max_attempts,
//              started_at, completed_at, cancelled_at, created_at
//
//   ai_usage_log
//     Columns: id, user_id, startup_id, generation_job_id, model,
//              input_tokens, output_tokens, cost_usd, purpose (ai_purpose enum),
//              created_at
//     NOTE: Every Anthropic/OpenAI call MUST write a row here — see Rule 15.
