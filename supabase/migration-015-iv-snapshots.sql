-- Migration 015: iv_snapshots table for IV trend detection.
--
-- Stores periodic IV snapshots to detect rising/falling/spiking IV trends.
-- Populated by api/ingest-iv.js on every POST (~15min OpenClaw refresh cadence).
-- Queried by useIvTrends hook (last 5 days per ticker).
-- Retention: 30 days — cleanup runs each ingest cycle.
-- At ~53 tickers × 96 refreshes/day × 30 days ≈ 153k rows max. Negligible storage.

CREATE TABLE IF NOT EXISTS iv_snapshots (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker      TEXT         NOT NULL,
  iv          NUMERIC,
  iv_rank     NUMERIC,
  captured_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iv_snapshots_ticker_time
  ON iv_snapshots (ticker, captured_at DESC);

ALTER TABLE iv_snapshots DISABLE ROW LEVEL SECURITY;
