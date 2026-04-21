-- Migration 013: Add earnings_meta JSONB to quotes for richer Finnhub data.
--
-- `earnings_date` (migration 012) holds the simple date used by the Radar EARN
-- column and the "avoid earnings within Xd" filter.
-- `earnings_meta` carries additional Finnhub fields that OpenClaw posts in:
--   { hour: "bmo"|"amc"|"", epsEstimate: number, revenueEstimate: number,
--     confidence: "high"|"medium"|"low", source: "finnhub" }

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS earnings_meta jsonb;
