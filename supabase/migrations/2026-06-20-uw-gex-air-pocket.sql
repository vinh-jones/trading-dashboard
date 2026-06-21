-- Consumer 3 (GEX): split the single "support" into a genuine positive-gamma
-- shelf (gex_support, redefined) and the negative-gamma acceleration zone
-- (gex_air_pocket, new). Per finance review — a negative-gamma strike below
-- spot is an accelerant, not support, so it must not be labelled or placed at
-- like a floor. gex_support now holds the dominant positive-gamma strike below
-- spot (defended); gex_air_pocket holds the dominant negative-gamma strike
-- below spot (avoid). Additive + nullable.
--
-- Idempotent: re-running is a no-op.

alter table public.uw_signals
  add column if not exists gex_air_pocket numeric;
