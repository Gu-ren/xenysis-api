// TODO(sprint-2): Activity log table
//
//   activity_log
//     Columns: id, user_id, startup_id (nullable FK → startups),
//              type, description, meta (JSONB), created_at
//     Append-only — never updated after insert.
//     Indexed on (user_id, created_at DESC) and (startup_id, created_at DESC).
