-- risk_snapshots — one row per market day capturing the descriptive-only
-- risk-unit readout (net beta-weighted delta / vega / theta, by-family,
-- per-position greeks, scenario grid, coverage) as it stood at EOD.
--
-- PURPOSE: instrument the Phase-1 observation window — make the review measured
-- rather than impressionistic, and enable (predicted risk -> realized P&L)
-- validation pairs. This is justified for validating Phase 1 itself; it is NOT
-- a commitment to build Phase 2.
--
-- WHY CAPTURE (vs backfill): the position greeks that feed these numbers are
-- EPHEMERAL — the quotes table upserts on `symbol` and overwrites prior IV/delta
-- — so "what was my net vega on a given day" is unanswerable after the fact
-- unless recorded here. (Price history for any future covariance work is
-- separately backfillable from market data and is deliberately NOT captured.)
--
-- The full risk block is kept as JSONB (don't pre-decide what matters); the flat
-- columns are query conveniences. Coverage detail lives inside `risk`
-- (coverage.uncovered + per-position beta_assumed) so lower-quality days — legs
-- without live greeks, or beta-assumed fallbacks — can be filtered out of any
-- later validation. Written daily by /api/snapshot (service role, non-blocking).
--
-- Idempotent: re-running is a no-op.

create table if not exists public.risk_snapshots (
  snapshot_date            date primary key,
  created_at               timestamptz not null default now(),
  account_value            numeric,
  vix                      numeric,
  net_beta_weighted_delta  numeric,   -- $ P&L per +1% SPX
  net_vega                 numeric,   -- $ P&L per +1 IV point
  net_theta                numeric,   -- $ P&L per calendar day
  covered_legs             integer,
  total_legs               integer,
  beta_assumed_count       integer,   -- legs that fell back to beta=1.0 (quality flag)
  risk                     jsonb not null
);

-- Read access for the SPA's anon client (mirrors quotes/uw_signals); writes stay
-- service-role only (the /api/snapshot cron), which bypasses RLS.
grant select on public.risk_snapshots to anon, authenticated;

alter table public.risk_snapshots enable row level security;

drop policy if exists "anon read" on public.risk_snapshots;
create policy "anon read" on public.risk_snapshots
  for select to anon using (true);
