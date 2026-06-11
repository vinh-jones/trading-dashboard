-- Add `beta` to the fundamentals table for the Radar tab.
--
-- Beta is a stock-level market-sensitivity statistic (how much a name moves
-- relative to the S&P 500), NOT an option Greek. It is slow-moving, so it
-- rides the existing fundamentals ingest (POST /api/ingest, fundamentals[])
-- rather than the ~15-min IV/quote pipeline. Sourced from Finnhub
-- /stock/metric (metric.beta), which OpenClaw already has a key for.
--
-- Nullable + additive: existing rows keep NULL until the next ingest backfills
-- them, and the app treats NULL beta as "unknown, no penalty" everywhere.
--
-- Idempotent: re-running this migration is a no-op.

ALTER TABLE fundamentals
  ADD COLUMN IF NOT EXISTS beta numeric;
