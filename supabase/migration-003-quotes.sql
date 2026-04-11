-- migration-003-quotes.sql
-- Price cache populated by api/quotes.js on lazy refresh (every 30min during market hours)

CREATE TABLE IF NOT EXISTS quotes (
  symbol          text        PRIMARY KEY,
  instrument_type text        NOT NULL,           -- 'EQUITY' or 'OPTION'
  last            numeric,
  bid             numeric,
  ask             numeric,
  mid             numeric,
  delta           numeric,                        -- nullable, reserved for future greeks fetch
  iv              numeric,                        -- nullable, reserved for future greeks fetch
  refreshed_at    timestamptz NOT NULL DEFAULT now()
);

-- No RLS needed — reads are public (anon key), writes use service key from api/quotes.js
ALTER TABLE quotes DISABLE ROW LEVEL SECURITY;
