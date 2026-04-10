-- migration-002-market-context.sql
-- Creates the market_context table for storing OpenClaw ETL output.
-- Each row is one ETL run. The app reads the latest row (ORDER BY as_of DESC LIMIT 1).

CREATE TABLE IF NOT EXISTS market_context (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  as_of        timestamptz NOT NULL,
  positions    jsonb       NOT NULL,  -- array of { ticker, exposureTypes, exposure, nextEarnings }
  macro_events jsonb       NOT NULL,  -- array of { eventType, title, dateTime, ... }
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_context_as_of ON market_context(as_of DESC);

-- Optional: keep only the last 30 rows to avoid unbounded growth.
-- Run this as a cron or manually periodically:
--
-- DELETE FROM market_context
-- WHERE id NOT IN (
--   SELECT id FROM market_context ORDER BY as_of DESC LIMIT 30
-- );
