// TODO(sprint-5): Startup health query against the startup_health SQL view.
//
//   GET    /api/v1/startups/:id/health
//   GET    /api/v1/startups/:id/health/services
//
// The view (startup_health) is defined in XENYSIS_BACKEND_SPEC.md §Database Design.
// It is a computed SQL view — NOT a table. Never introduce a sync pattern.
