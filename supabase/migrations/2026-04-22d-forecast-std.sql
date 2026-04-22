-- Pipeline Forecast v2.1 — per-bucket std + portfolio-level uncertainty.
-- Enables confidence-interval display on the Premium Pipeline summary.
--
-- Adds:
--   forecast_calibration.calibrated_std      — std of kept_pct within the bucket
--   daily_snapshots.forecast_this_month_std  — aggregate $ std for "expected this month"
--
-- Backfills std values for the two CALIBRATED buckets from the 2026-04-22
-- backtest notes. Uncalibrated buckets stay NULL; algorithm falls back to
-- DEFAULT_UNCERTAINTY_STD (0.15).

ALTER TABLE public.forecast_calibration
  ADD COLUMN IF NOT EXISTS calibrated_std numeric;

ALTER TABLE public.daily_snapshots
  ADD COLUMN IF NOT EXISTS forecast_this_month_std numeric;

-- Backfill observed stds from the 2026-04-22 backtest.
UPDATE public.forecast_calibration
SET calibrated_std = 0.158
WHERE position_type = 'csp' AND bucket = 'profit_60_plus'
  AND calibration_date = '2026-04-22'
  AND calibrated_std IS NULL;

UPDATE public.forecast_calibration
SET calibrated_std = 0.061
WHERE position_type = 'cc' AND bucket = 'profit_80_plus'
  AND calibration_date = '2026-04-22'
  AND calibrated_std IS NULL;
