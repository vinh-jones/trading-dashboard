-- migration-017: add type/strike/expiry columns to journal_entries
-- Already applied to remote on 2026-05-10. This file is the canonical record.
--
-- These columns let position_note (and trade_note) journal entries be matched
-- back to specific open positions by (ticker, type, strike, expiry) for the
-- Open Positions tag-display feature in v1.111.0.

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS type   text,
  ADD COLUMN IF NOT EXISTS strike numeric,
  ADD COLUMN IF NOT EXISTS expiry date;

CREATE INDEX IF NOT EXISTS idx_journal_entries_ticker_type_strike_expiry
  ON journal_entries (ticker, type, strike, expiry);
