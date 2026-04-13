-- migration-006-option-expiries.sql
--
-- Daily cache for available option expiry dates per ticker.
-- Populated by a future /api/refresh-expiries endpoint (or inline in /api/quotes).
--
-- Expiry dates only change overnight, so this table needs at most one refresh
-- per day — not on every 2-hour quotes cycle.
--
-- Usage:
--   SELECT expiry_date FROM option_expiries
--   WHERE ticker = 'PLTR' AND expiry_date > CURRENT_DATE
--   ORDER BY expiry_date
--   LIMIT 10;

CREATE TABLE IF NOT EXISTS option_expiries (
  ticker        text    NOT NULL,
  expiry_date   date    NOT NULL,
  is_monthly    boolean NOT NULL DEFAULT false,  -- true = standard 3rd-Friday monthly expiry
  refreshed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, expiry_date)
);

ALTER TABLE option_expiries DISABLE ROW LEVEL SECURITY;

-- Fast lookup by ticker + date range
CREATE INDEX IF NOT EXISTS option_expiries_ticker_date
  ON option_expiries (ticker, expiry_date);
