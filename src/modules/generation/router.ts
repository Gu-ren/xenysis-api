// TODO(sprint-3): Generation job routes
//
//   POST   /api/v1/startups/:id/generate   ← SSE: full pipeline (parent + 3 child jobs)
//   GET    /api/v1/startups/:id/jobs
//   GET    /api/v1/jobs/:jobId
//   GET    /api/v1/jobs/:jobId/stream      ← SSE: live stream + reconnect replay
//   POST   /api/v1/jobs/:jobId/cancel
//
// NOTE: SSE endpoints must be called against the Railway URL directly —
// never proxied through Next.js API routes (Vercel timeout = 25s/60s).
