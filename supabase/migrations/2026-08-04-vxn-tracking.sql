-- Track VXN (Nasdaq-100 volatility index) alongside VIX while Ryan's VXN-based
-- cash-allocation framework is under evaluation (started 2026-08-04).
--
-- Deliberately SEPARATE columns rather than reusing vix / vix_band: VIX remains
-- the framework with decision authority (focusEngine, computeForecastV2, the
-- cash-band status in the header all read it). Writing VXN into the existing
-- columns would silently change what historical rows mean, with no way to tell
-- pre- and post-switch rows apart afterward.
--
-- vxn_band stores the range LABEL from getVxnBand ("25–30", "15–19", …) rather
-- than the sentiment, to match exactly what api/snapshot.js writes into the
-- sibling vix_band columns. Adjacent columns holding different kinds of value
-- is a trap for anyone comparing the two frameworks in SQL later; sentiment is
-- recoverable from the label 1:1 anyway.
ALTER TABLE public.daily_snapshots   ADD COLUMN IF NOT EXISTS vxn      numeric;
ALTER TABLE public.daily_snapshots   ADD COLUMN IF NOT EXISTS vxn_band text;
ALTER TABLE public.account_snapshots ADD COLUMN IF NOT EXISTS vxn_current numeric;
ALTER TABLE public.account_snapshots ADD COLUMN IF NOT EXISTS vxn_band    text;

COMMENT ON COLUMN public.daily_snapshots.vxn IS
  'CBOE Nasdaq-100 Volatility Index close, written by api/snapshot.js. Comparison-only during the VXN framework evaluation — does not drive deployment targets.';
COMMENT ON COLUMN public.daily_snapshots.vxn_band IS
  'Range label from getVxnBand (Ryan''s 6-zone VXN table), e.g. 25-30. Comparison-only; cash_floor/ceiling_target_pct stay VIX-derived.';
COMMENT ON COLUMN public.account_snapshots.vxn_current IS
  'Latest VXN reading, patched by api/snapshot.js alongside vix_current. Comparison-only.';
COMMENT ON COLUMN public.account_snapshots.vxn_band IS
  'Range label from getVxnBand for vxn_current. Comparison-only.';
