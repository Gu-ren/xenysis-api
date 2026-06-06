// TODO(sprint-5): Deploy tables
//
//   deploy_environments
//     Columns: id, startup_id, name (environment_name enum), branch, region,
//              platform, build_command, output_dir, url, created_at, updated_at
//     Constraint: UNIQUE(startup_id, name)
//
//   deploy_env_vars
//     Columns: id, environment_id (FK → deploy_environments, CASCADE DELETE),
//              key, value_encrypted (AES-256-GCM: "iv:authTag:ciphertext"),
//              created_at, updated_at
//     Constraint: UNIQUE(environment_id, key)
//
//   releases
//     Columns: id, environment_id, version, status (release_status enum),
//              commit_sha, triggered_by, created_at
//     Append-only — never updated after insert.
//
//   ENCRYPTION_KEY note: 32-byte secret in env — never in DB or logs.
//   Key rotation requires a migration script (see spec §Security).
