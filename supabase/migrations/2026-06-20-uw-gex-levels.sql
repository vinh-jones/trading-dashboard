-- Consumer 3 (GEX / strike walls): per-ticker derived gamma levels, written by
-- the api/uw-gex cron. Additive + nullable so the app treats NULL as
-- "no GEX signal". gex_env: 'stabilized' | 'choppy' | 'neutral'.
--
-- Idempotent: re-running is a no-op.

alter table public.uw_signals
  add column if not exists gex_env          text,
  add column if not exists gex_net_gamma    numeric,
  add column if not exists gex_support      numeric,   -- positive-gamma support wall (strike below spot)
  add column if not exists gex_resistance   numeric,   -- positive-gamma resistance wall (strike above spot)
  add column if not exists gex_refreshed_at timestamptz;
