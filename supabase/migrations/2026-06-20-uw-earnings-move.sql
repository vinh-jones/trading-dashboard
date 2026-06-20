-- Consumer 2 v2: store the earnings expected-move % alongside short interest.
-- short_interest_pct already exists on uw_signals; add the expected-move field.
-- Populated by api/uw-assignment-data.js (open-position tickers only). Nullable
-- + additive — the assignment-risk lib treats NULL as "no data, no factor".

alter table public.uw_signals
  add column if not exists earnings_expected_move_pct numeric;
