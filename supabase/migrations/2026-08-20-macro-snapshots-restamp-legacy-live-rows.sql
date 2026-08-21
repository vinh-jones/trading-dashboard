-- Migration: restamp the two pre-v1.183.0 live macro_snapshots rows
--
-- 2026-04-22 and 2026-08-19 were written by the old five-column writer. They carry
-- a posture_score but no signal_scores and no signals_available, which makes them
-- exactly the ambiguous rows signals_available exists to prevent: 2.8 could be a
-- genuine middling read or a read with a dead feed, and nothing in the row says
-- which. They are also the only two live rows that predate the census, so leaving
-- them unfilterable would quietly poison any query that does not think to exclude
-- them.
--
-- RESTAMPED, NOT NULLED. Every missing field is recoverable from the row's own
-- ai_context, which the old writer did store and which contains the full
-- per-signal breakdown from that run — including the crude and 10-year values that
-- never had columns. This is recovery from the row's own contents, not a re-fetch
-- of today's market and not an estimate.
--
-- SELF-CHECK: the recovered per-signal scores reproduce the already-stored
-- posture_score in both rows, which is a strong independent check that the
-- recovery is faithful rather than plausible:
--   2026-04-22  (5+4+4+2+3+2+3)/7 = 3.2857 -> 3.3   matches stored 3.3
--   2026-08-19  (3+4+1+4+3+2)/6   = 2.8333 -> 2.8   matches stored 2.8
-- The migration asserts this rather than trusting it; see the DO block at the end.
--
-- vix_change / vix_5d_change are derived from daily_snapshots the same way the
-- 2026-08-19 backfill derives them, so they are consistent with the 94 rows
-- around them.
--
-- PRECISION NOTE: ai_context renders the 10-year with toFixed(2), so ust10y is
-- recovered to 2dp (4.65, where the live payload carried 4.653). A rounded record
-- of the true value, not an estimate — but do not treat these two rows as
-- 3dp-precise on that column.
--
-- spec_version is 'macro-persistence-v1-restamp', not 'macro-persistence-v1', so
-- these two rows stay greppable as reconstructed rather than directly written.
-- source stays 'live' — they were written by the real cron path.
--
-- 2026-04-22 turns out to be a complete seven-signal row (signals_available = 7);
-- 2026-08-19 is six, S5FI having been unavailable that day.

BEGIN;

UPDATE macro_snapshots SET
  vix_change           = -0.58,
  vix_5d_change        = 0.75,
  wti_crude            = 92.49,
  wti_crude_change     = 8.64,
  ust10y               = 4.29,
  ust10y_change_bps    = -1,
  fed_implied_eoy_rate = 3.555,
  fed_current_rate     = 3.625,
  signal_scores = jsonb_build_object(
    'vix', 5, 's5fi', 4, 'fear_greed', 4, 'fed', 2, 'spy_ath', 3, 'oil', 2, 'rates', 3),
  signals_available = 7,
  signals_total     = 7,
  deployment_guidance = 'Selective deployment only. Higher-quality names, wider strikes. Hold 20-25% cash. Wait for clearer signals.',
  spec_version        = 'macro-persistence-v1-restamp'
WHERE snapshot_date = '2026-04-22';

UPDATE macro_snapshots SET
  vix_change           = -0.95,
  vix_5d_change        = 0.34,
  wti_crude            = 84.40,
  wti_crude_change     = 2.00,
  ust10y               = 4.65,
  ust10y_change_bps    = 1,
  fed_implied_eoy_rate = 3.852,
  fed_current_rate     = 3.625,
  -- S5FI was unavailable: null, never a fallback number.
  signal_scores = jsonb_build_object(
    'vix', 3, 's5fi', NULL, 'fear_greed', 4, 'fed', 1, 'spy_ath', 4, 'oil', 3, 'rates', 2),
  signals_available = 6,
  signals_total     = 7,
  deployment_guidance = 'Selective deployment only. Higher-quality names, wider strikes. Hold 20-25% cash. Wait for clearer signals.',
  spec_version        = 'macro-persistence-v1-restamp'
WHERE snapshot_date = '2026-08-19';

-- Assert the recovery reproduces the stored composite, and that no live row is
-- left unfilterable. Either failure aborts the transaction.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM (
    SELECT posture_score,
           round((SELECT avg(v::numeric) FROM jsonb_each_text(signal_scores) AS e(k, v)
                  WHERE v IS NOT NULL), 1) AS recomputed
    FROM macro_snapshots
    WHERE spec_version = 'macro-persistence-v1-restamp'
  ) t
  WHERE recomputed IS DISTINCT FROM posture_score;
  IF bad > 0 THEN
    RAISE EXCEPTION 'restamp check failed: % row(s) whose signal_scores do not reproduce posture_score', bad;
  END IF;

  SELECT count(*) INTO bad FROM macro_snapshots
  WHERE source = 'live' AND (signals_available IS NULL OR signal_scores IS NULL);
  IF bad > 0 THEN
    RAISE EXCEPTION 'still % live row(s) with no signals_available/signal_scores', bad;
  END IF;
END $$;

COMMIT;
