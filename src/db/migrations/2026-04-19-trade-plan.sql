-- Phase 1 migration: replace coarse `action` with structured TradePlan.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + DO blocks for constraints.
-- Apply with:
--   psql "$DATABASE_URL" -f src/db/migrations/2026-04-19-trade-plan.sql

BEGIN;

-- proposed_decisions: add TradePlan columns
ALTER TABLE proposed_decisions
  ADD COLUMN IF NOT EXISTS entry_zone_low    NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS entry_zone_high   NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS invalidation_price NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS target_price      NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS timeframe         VARCHAR(10),
  ADD COLUMN IF NOT EXISTS correlation_notes TEXT,
  ADD COLUMN IF NOT EXISTS conviction        SMALLINT;

DO $$ BEGIN
  ALTER TABLE proposed_decisions
    ADD CONSTRAINT proposed_decisions_timeframe_check
    CHECK (timeframe IS NULL OR timeframe IN ('scalp', 'swing', 'position'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE proposed_decisions
    ADD CONSTRAINT proposed_decisions_conviction_check
    CHECK (conviction IS NULL OR conviction BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Drop old coarse-action columns. Paper-trading demo: no prod data concerns.
ALTER TABLE proposed_decisions DROP CONSTRAINT IF EXISTS proposed_decisions_time_horizon_check;
ALTER TABLE proposed_decisions
  DROP COLUMN IF EXISTS invalidation,
  DROP COLUMN IF EXISTS time_horizon;

-- pending_approvals: edited_* columns for full TradePlan editing
ALTER TABLE pending_approvals
  ADD COLUMN IF NOT EXISTS edited_entry_zone_low     NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS edited_entry_zone_high    NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS edited_invalidation_price NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS edited_target_price       NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS edited_conviction         SMALLINT;

DO $$ BEGIN
  ALTER TABLE pending_approvals
    ADD CONSTRAINT pending_approvals_edited_conviction_check
    CHECK (edited_conviction IS NULL OR edited_conviction BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
