-- migration-026: dedicated freshness stamp for api/quotes.js live marks
--
-- `refreshed_at` is a shared column — api/bb.js (every 15 min) and api/uw-iv.js
-- (every 30 min) also stamp it on EQUITY rows — so it can't tell whether the
-- live Public.com fetch actually ran. That masking made /api/quotes' own refresh
-- gate think the table was always fresh, so option marks froze at the 9:30 open.
--
-- Give api/quotes.js its own freshness column and gate on it, mirroring the
-- bb_refreshed_at / earnings_refreshed_at pattern. Nullable, no default:
-- backward-compatible, no table rewrite.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quotes_refreshed_at timestamptz;

-- Backfill: only api/quotes.js writes OPTION rows, so their refreshed_at is a
-- faithful historical value for the new column. Seeds the gate so it doesn't
-- read "never refreshed" on the first post-deploy tick.
UPDATE quotes
   SET quotes_refreshed_at = refreshed_at
 WHERE instrument_type = 'OPTION'
   AND quotes_refreshed_at IS NULL;
