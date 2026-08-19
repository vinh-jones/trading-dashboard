-- Migration: macro_snapshots — carry all seven signals, not five
--
-- Workstream A of the 2026-08-19 macro-persistence spec. The posture model scores
-- seven signals but the table only ever stored five: crude oil and the 10-year had
-- no columns at all, and the per-signal scores were collapsed into one average with
-- no way to attribute which signal moved the composite.
--
-- Context: this table held ONE row (2026-04-22) until 2026-08-19 because the write
-- in api/snapshot.js self-fetched /api/macro and Vercel Deployment Protection 302'd
-- it to SSO. Fixed in v1.181.0. The unique constraint the spec asks for
-- (macro_snapshots_snapshot_date_key) already existed and is not recreated here.
--
-- signal_scores is jsonb because the signal set has changed before and will change
-- again; the raw values stay typed because that is what analysis queries against.
--
-- signals_available / signals_total are NOT in the spec, and are the most important
-- columns here. An unavailable signal used to score a fallback 3, indistinguishable
-- from a genuine neutral reading (v1.181.0 changed it to null). Without a stored
-- count, a posture_score of 3.2 is ambiguous forever: it could mean "genuinely
-- mediocre" or "two feeds were dead". Analysis must filter on
-- `signals_available = signals_total` to get comparable rows. signals_total is
-- stored rather than hardcoded to 7 so a future signal-set change stays legible.
--
-- source distinguishes 'live' from 'backfill'. The two existing rows predate the
-- column and are stamped 'live' below — both were written by the real cron path.

BEGIN;

ALTER TABLE macro_snapshots
  ADD COLUMN IF NOT EXISTS wti_crude            numeric,   -- $/bbl
  ADD COLUMN IF NOT EXISTS wti_crude_change     numeric,   -- $ change on day
  ADD COLUMN IF NOT EXISTS ust10y               numeric,   -- percent, e.g. 4.71
  ADD COLUMN IF NOT EXISTS ust10y_change_bps    numeric,
  ADD COLUMN IF NOT EXISTS vix_change           numeric,   -- change on day
  ADD COLUMN IF NOT EXISTS vix_5d_change        numeric,   -- 5-session, the "trend" line
  ADD COLUMN IF NOT EXISTS fed_implied_eoy_rate numeric,
  ADD COLUMN IF NOT EXISTS fed_current_rate     numeric,
  ADD COLUMN IF NOT EXISTS signal_scores        jsonb,     -- per-signal, null = unavailable
  ADD COLUMN IF NOT EXISTS deployment_guidance  text,
  ADD COLUMN IF NOT EXISTS spec_version         text,
  ADD COLUMN IF NOT EXISTS source               text,      -- 'live' | 'backfill'
  ADD COLUMN IF NOT EXISTS signals_available    smallint,
  ADD COLUMN IF NOT EXISTS signals_total        smallint;

-- Only these two values are meaningful; anything else is a bug in the writer.
ALTER TABLE macro_snapshots
  DROP CONSTRAINT IF EXISTS macro_snapshots_source_check;
ALTER TABLE macro_snapshots
  ADD CONSTRAINT macro_snapshots_source_check
  CHECK (source IS NULL OR source IN ('live', 'backfill'));

-- The two pre-existing rows both came from the real cron path.
UPDATE macro_snapshots SET source = 'live' WHERE source IS NULL;

-- Analysis reads this table by date range and almost always filters to complete
-- rows; the partial index keeps that path off a sequential scan as history grows.
CREATE INDEX IF NOT EXISTS idx_macro_snapshots_complete
  ON macro_snapshots (snapshot_date DESC)
  WHERE signals_available IS NOT NULL AND signals_available = signals_total;

COMMIT;
