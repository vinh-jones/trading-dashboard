-- Migration 012: Add prev_close + earnings_date to quotes table.
--
-- prev_close: yesterday's close, used to compute intraday % change on Radar
--             rows. Populated by api/bb.js (which already calls Yahoo chart
--             and returns chartPreviousClose in meta).
--
-- earnings_date: next earnings report date for wheel universe tickers.
--                Populated by a new api/wheel-earnings.js endpoint (Yahoo
--                quoteSummary → calendarEvents.earnings).
-- earnings_refreshed_at: used for staleness (≥20h before refetch).

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS prev_close numeric;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS earnings_date date;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS earnings_refreshed_at timestamptz;
