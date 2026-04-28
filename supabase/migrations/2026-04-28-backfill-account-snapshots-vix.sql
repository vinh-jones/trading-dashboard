-- Backfill account_snapshots.vix_current and vix_band from daily_snapshots.
--
-- account_snapshots.vix_current was never populated — the sync reads from
-- Google Sheets which doesn't carry VIX. The fix (2026-04-28) now patches
-- account_snapshots after every sync and every EOD cron, but historical rows
-- remain null. This migration fills them in using daily_snapshots.vix, which
-- the EOD cron has been writing from Yahoo Finance since the cron started.
--
-- Safe to re-run: only touches rows where vix_current IS NULL.

UPDATE public.account_snapshots a
SET
  vix_current = d.vix,
  vix_band    = d.vix_band
FROM public.daily_snapshots d
WHERE a.snapshot_date = d.snapshot_date
  AND a.vix_current IS NULL
  AND d.vix IS NOT NULL;
