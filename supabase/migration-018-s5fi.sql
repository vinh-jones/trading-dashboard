-- migration-018-s5fi.sql
-- Creates the s5fi table: daily % of S&P 500 trading above its 50-day MA.
-- Finviz's Cloudflare 403s Vercel datacenter IPs, so OpenClaw scrapes this
-- on a residential IP once/day and POSTs to /api/ingest-s5fi. The app reads
-- the latest row (ORDER BY as_of DESC LIMIT 1) in /api/macro.

CREATE TABLE IF NOT EXISTS s5fi (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  as_of      timestamptz NOT NULL,
  pct        numeric     NOT NULL,  -- % of S&P 500 above 50-day MA (0-100)
  above      integer,               -- count above 50DMA (optional)
  total      integer,               -- S&P 500 count (optional)
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_s5fi_as_of ON s5fi(as_of DESC);

-- Optional: keep only the last 90 rows to avoid unbounded growth.
-- DELETE FROM s5fi
-- WHERE id NOT IN (SELECT id FROM s5fi ORDER BY as_of DESC LIMIT 90);
