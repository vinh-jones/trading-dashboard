-- Phase C — surface per-position forecast breakdown on the daily snapshot.
--
-- Each row is a snapshot of what the v2 forecast module predicts for an
-- individual open CSP/CC on the given date. Used by the Pipeline Detail
-- panel to make the capture numbers inspectable ("why is expected $X?").
--
-- Stored as a JSONB array for compact transport — Pipeline Detail is a
-- read-only visualization, and the canonical per-day state lives in
-- position_daily_state for future trajectory calibration.

ALTER TABLE daily_snapshots
  ADD COLUMN IF NOT EXISTS forecast_per_position JSONB;

COMMENT ON COLUMN daily_snapshots.forecast_per_position IS
  'v2 per-position forecast breakdown: array of {ticker, type, strike, expiry, bucket, capture_pct, premium_at_open, remaining, this_month}. Powers the Pipeline Detail panel.';
