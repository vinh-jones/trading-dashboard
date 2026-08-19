-- Migration: agentic shadow columns — A6 + Workstream B2 of the macro spec
--
-- ⚠ SHADOW ONLY. Nothing here may be read by any entry, exit, size, or gate
-- decision in the agentic account. These columns exist to make a counterfactual
-- answerable later; they are instrumentation, not inputs.
--
-- ⚠ SCHEMA ONLY — THIS REPO DOES NOT WRITE THESE TABLES. `agentic_log` and
-- `agentic_factor_snapshots` have no code anywhere in trading-dashboard; the
-- agentic runner is external and writes them directly. This migration lands the
-- columns so that runner can start populating them. Whoever owns the runner still
-- has to do the writing, and still owns spec acceptance criteria 4, 5, 6 and 7.
--
-- ── A6: stamp the macro posture onto every run ──────────────────────────────
-- Written on the `run_summary` row of each run, read from macro_snapshots for the
-- prior close. READ-ONLY STAMP. IT GATES NOTHING. This is the join key that makes
-- the counterfactual answerable without reconstructing anything.
--
-- The spec offered `details` jsonb as an alternative to adding columns. Real
-- columns win here: this is the join key for every later analysis, and a jsonb
-- path is both slower to filter and easier to typo into silence.
--
-- NOT BACKFILLABLE. The 29 existing run_summary rows span 2026-07-21 → 08-19, and
-- macro_snapshots held only 2026-04-22 for all of that window (the write was broken
-- — see 2026-08-19-macro-snapshots-full-signals.sql). There is no posture history
-- to join to. These stay NULL for every run before the runner starts stamping.
--
-- ── B2: exactly three new factors, pre-registered ───────────────────────────
-- Three, not seven: testing seven factors against the ~25-35 closed positions
-- expected by year end is noise mining. Hypotheses are frozen in
-- docs/agentic-factor-preregistration.md, dated before any data exists.
--
-- Captured for the top 10 by core_score only — factor_scope records which rows
-- carry them. All ~59 rows/day keep being written with the existing columns.
--
-- The *_as_of columns are not decoration. analyst_net_30d and insider_net_90d
-- refresh weekly, so on other days the last known value is carried forward and its
-- true as-of date recorded. A stale value with an honest date is analysable; a
-- stale value without one is a lie, and a NULL discards information we have.

BEGIN;

ALTER TABLE agentic_log
  ADD COLUMN IF NOT EXISTS macro_posture       text,
  ADD COLUMN IF NOT EXISTS macro_posture_score numeric;

COMMENT ON COLUMN agentic_log.macro_posture IS
  'SHADOW. Prior-close macro posture label from macro_snapshots. Read-only stamp on run_summary rows; gates nothing.';
COMMENT ON COLUMN agentic_log.macro_posture_score IS
  'SHADOW. Prior-close composite from macro_snapshots. Check that row''s signals_available = signals_total before comparing across dates.';

ALTER TABLE agentic_factor_snapshots
  ADD COLUMN IF NOT EXISTS analyst_net_30d     numeric,  -- upgrades - downgrades, trailing 30d
  ADD COLUMN IF NOT EXISTS short_volume_ratio  numeric,  -- latest daily ratio
  ADD COLUMN IF NOT EXISTS insider_net_90d     numeric,  -- net $ bought - sold, trailing 90d
  ADD COLUMN IF NOT EXISTS factor_scope        text,     -- 'full' | 'top10'
  ADD COLUMN IF NOT EXISTS analyst_as_of       date,
  ADD COLUMN IF NOT EXISTS insider_as_of       date;

ALTER TABLE agentic_factor_snapshots
  DROP CONSTRAINT IF EXISTS agentic_factor_snapshots_factor_scope_check;
ALTER TABLE agentic_factor_snapshots
  ADD CONSTRAINT agentic_factor_snapshots_factor_scope_check
  CHECK (factor_scope IS NULL OR factor_scope IN ('full', 'top10'));

COMMENT ON COLUMN agentic_factor_snapshots.factor_scope IS
  'SHADOW. ''top10'' rows carry the three extra factors; ''full'' rows do not. Absence of a factor on a ''full'' row is by design, not a gap.';

-- The analysis path is "top10 rows over a date range", every time.
CREATE INDEX IF NOT EXISTS idx_agentic_factor_snapshots_top10
  ON agentic_factor_snapshots (run_at DESC)
  WHERE factor_scope = 'top10';

COMMIT;
