-- Consumer 3 (GEX): per-expiry max-pain (pin level) from UW's /max-pain
-- endpoint, stored as { "YYYY-MM-DD": price } for upcoming expiries. Scoped to
-- held tickers by the uw-gex cron (pin risk matters on positions you hold into
-- expiry). Additive + nullable.
--
-- Idempotent: re-running is a no-op.

alter table public.uw_signals
  add column if not exists max_pain jsonb;
