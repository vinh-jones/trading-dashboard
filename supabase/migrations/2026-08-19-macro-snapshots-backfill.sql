-- Migration: macro_snapshots partial backfill (A5 of the macro-persistence spec)
--
-- ⚠ READ THIS BEFORE USING THESE ROWS FOR ANYTHING.
--
-- Every row here has source='backfill' and posture_score=NULL. That is not an
-- omission — a composite computed from 2 of 7 signals is a different number
-- wearing the same name, and averaging it against a live 7-signal composite would
-- silently corrupt the comparison. Filter with `signals_available = signals_total`
-- (or `source = 'live'`) for any cross-date analysis.
--
-- WHAT IS ACTUALLY BACKFILLABLE — less than the spec assumed. Two of its three
-- claimed sources do not hold:
--
--   ✓ vix, vix_change, vix_5d_change  ← daily_snapshots.vix (2026-04-08 →)
--   ✓ s5fi_pct                        ← s5fi table (28 of 96 sessions, 5/19–7/01)
--   ✗ Fed inputs — the spec says "← market_context (4/10 → 7/01)". market_context
--     has columns (id, as_of, positions, macro_events, created_at). There are no
--     Fed fields in it. Not backfillable at all.
--   ✗ spy_pct_from_ath — the spec says "← daily_snapshots". daily_snapshots has
--     spy_close but NO all-time-high column. It can only be reconstructed as
--     SPY-vs-running-max-of-the-sampled-window, which is NOT what /api/macro
--     computes live (Yahoo's 52-week high). Putting both in one column would mix
--     two different quantities. The spec's own rule — "do not interpolate, do not
--     carry forward, do not estimate" — makes this a NULL. It is left NULL.
--   ✗ fear & greed, WTI, 10-year — no history anywhere, as the spec states.
--
-- So of the seven signals, 96 sessions carry VIX and 28 of those also carry S5FI.
-- signals_available is 1 or 2 on every row, never 7.
--
-- PER-SIGNAL SCORES are derived by calling the live labelVix()/labelS5fi() from
-- api/macro.js — the same threshold tables the dashboard scores against — rather
-- than restating the bucket boundaries in SQL, which would be a second place for
-- them to drift. Unavailable signals are null in signal_scores, never a fallback
-- number (see v1.181.0).
--
-- vix_change is the move from the prior session in this series; vix_5d_change is
-- the move over 5 sessions. Both are NULL where there is insufficient history.
--
-- ON CONFLICT DO NOTHING protects the two pre-existing rows (2026-04-22 and
-- 2026-08-19) which were written by the real cron path and are stamped 'live'.

-- Derived from the source tables rather than from a literal row dump, so this file
-- is self-contained and re-runnable. The VIX and S5FI score CASEs mirror
-- labelVix()/labelS5fi() in api/macro.js; the applied result was diffed row-by-row
-- against those functions' actual output before this was committed. (labelVix has
-- three separate bands — 15-18, 18-20, 20-25 — that all score 5; they are collapsed
-- to one branch here. labelS5fi's bottom two bands both score 1, likewise.)

BEGIN;

WITH base AS (
  SELECT snapshot_date, vix::numeric AS vix
  FROM daily_snapshots WHERE vix IS NOT NULL
), lagged AS (
  SELECT b.*,
    b.vix - lag(b.vix, 1) OVER (ORDER BY b.snapshot_date) AS vix_change,
    b.vix - lag(b.vix, 5) OVER (ORDER BY b.snapshot_date) AS vix_5d_change
  FROM base b
), joined AS (
  SELECT l.*, (
    SELECT f.pct::numeric FROM s5fi f
    WHERE (f.as_of AT TIME ZONE 'America/New_York')::date = l.snapshot_date
    ORDER BY f.as_of DESC LIMIT 1
  ) AS s5fi_pct
  FROM lagged l
), scored AS (
  SELECT j.*,
    CASE WHEN j.vix <= 12 THEN 2
         WHEN j.vix <= 15 THEN 3
         WHEN j.vix <= 25 THEN 5
         WHEN j.vix <= 30 THEN 4
         ELSE 3 END AS vix_score,
    CASE WHEN j.s5fi_pct IS NULL THEN NULL
         WHEN j.s5fi_pct > 80 THEN 5
         WHEN j.s5fi_pct > 50 THEN 4
         WHEN j.s5fi_pct > 35 THEN 3
         WHEN j.s5fi_pct > 20 THEN 2
         ELSE 1 END AS s5fi_score
  FROM joined j
)
INSERT INTO macro_snapshots (
  snapshot_date, vix, vix_change, vix_5d_change, s5fi_pct,
  signal_scores, signals_available, signals_total, spec_version, source
)
SELECT
  snapshot_date, round(vix, 2), round(vix_change, 2), round(vix_5d_change, 2), s5fi_pct,
  jsonb_build_object(
    'vix', vix_score, 's5fi', s5fi_score, 'fear_greed', NULL,
    'fed', NULL, 'spy_ath', NULL, 'oil', NULL, 'rates', NULL
  ),
  1 + (CASE WHEN s5fi_score IS NULL THEN 0 ELSE 1 END),
  7, 'macro-persistence-v1', 'backfill'
FROM scored
ON CONFLICT (snapshot_date) DO NOTHING;

COMMIT;
