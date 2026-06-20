-- uw_signals: per-ticker Unusual Whales signals, refreshed intraday by the UW
-- ingestion job. Feeds the entry-score modifiers (gamma_env, flow_sentiment)
-- and the Whale CSP flow list, plus near-term assignment-defense fields.
--
-- Scale-free signals are pre-normalized to [-1, 1] by src/lib/uwNormalize.js.
-- Additive + nullable: the app treats NULL as "no signal" (the entry-score
-- modifiers become no-ops), so this is safe before the first ingestion run.
--
-- Idempotent: re-running is a no-op.

create table if not exists public.uw_signals (
  ticker             text primary key,
  gamma_env          numeric,   -- net dealer gamma (call+put)/(|call|+|put|), [-1,1]
  flow_sentiment     numeric,   -- bullish/bearish options flow, [-1,1]
  whale_put_sells    jsonb,     -- institutions selling puts (Consumer 5); [] when none
  short_interest_pct numeric,   -- Consumer 2 (assignment defense)
  next_earnings_date date,      -- Consumer 2 (UW; cross-checks quotes.earnings_date)
  refreshed_at       timestamptz
);
