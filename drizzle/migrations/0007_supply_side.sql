-- v2.2 PR3: Supply Side Discovery
-- Adds normalized supply_side_confidence column for marketplace sessions.
-- Non-marketplace sessions will always have 0 here (supply_side is invisible to them).

ALTER TABLE founder_understanding
  ADD COLUMN IF NOT EXISTS supply_side_confidence INTEGER NOT NULL DEFAULT 0
    CHECK (supply_side_confidence BETWEEN 0 AND 100);
