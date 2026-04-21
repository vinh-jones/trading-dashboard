-- Migration 014: Add 50-day and 200-day moving average columns to quotes.
--
-- Populated by api/bb.js during the same refresh cycle as bb_position.
-- Source: Yahoo Finance meta.fiftyDayAverage / meta.twoHundredDayAverage.
-- Null handling: if either MA is unavailable, treated as "above" in getTrendState
-- (no penalty) rather than applying a downtrend modifier incorrectly.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS ma_50  numeric;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS ma_200 numeric;
