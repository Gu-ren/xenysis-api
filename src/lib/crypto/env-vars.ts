// TODO(sprint-5): AES-256-GCM encryption for deploy environment variable values.
//
// Storage format: "iv:authTag:ciphertext" (each segment hex-encoded, colon-delimited)
// Key: ENCRYPTION_KEY env var — 32-byte hex string, never stored in DB or logs.
//
// export function encrypt(plaintext: string): string
// export function decrypt(stored: string): string
//
// Key rotation requires a migration script that re-encrypts all
// deploy_env_vars.value_encrypted rows.
