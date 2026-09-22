-- Daily assigned-share exposure — docs/spec_share_exposure_daily_v1.md
--
-- ONE ROW PER CALENDAR DAY back to 2025-11-21. Kept out of account_snapshots
-- on purpose: that table has weekend/pre-April gaps, and filling them would
-- mean fabricating account rows just to carry exposure data.
--
-- Everything is GROSS ASSIGNMENT BASIS (capital_fronted), never market value —
-- a position down 25% is more dangerous, not smaller.
--
-- book_denominator is stored per row because account_value has been static
-- since at least April (display bug, not fixed in v1). Storing it lets the pct
-- be recomputed if that's ever corrected.
--
-- source: 'live' (written by the 21:30 UTC snapshot cron for its own day) or
-- 'backfill_ledger' (reconstructed from trades + positions.lots — the one-time
-- backfill, plus weekends/missed days the Mon–Fri cron fills in on its next run).

CREATE TABLE IF NOT EXISTS share_exposure_daily (
  snapshot_date        DATE        PRIMARY KEY,
  shares_basis_total   NUMERIC     NOT NULL,
  shares_basis_pct     NUMERIC,
  book_denominator     NUMERIC     NOT NULL,
  n_tickers            INTEGER     NOT NULL,
  by_ticker            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  leaps_basis_total    NUMERIC,
  csp_collateral_total NUMERIC,     -- type = 'CSP' only; CCs never counted
  source               TEXT        NOT NULL CHECK (source IN ('live', 'backfill_ledger')),
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-only (service key writes, no browser reads) → RLS on, no anon policy.
ALTER TABLE share_exposure_daily ENABLE ROW LEVEL SECURITY;
