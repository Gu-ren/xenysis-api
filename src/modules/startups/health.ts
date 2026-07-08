// Health is computed inline in the router (GET /api/v1/startups/:id/health).
//
// Score derivation (by lifecycle_stage):
//   founder-session → 20    generating → 40    preview → 55
//   build → 75              deployed   → 100
//
// asset_count = COUNT(blueprints) + COUNT(opportunity_assessments) for the startup.
