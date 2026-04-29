-- position-lifespan: add spot_at_assignment to trades table.
-- Populated only on CSP rows where subtype = 'Assigned'.
-- Stores the underlying spot price on the day of assignment, entered manually
-- by the user at logging time (or backfilled from brokerage history).
-- Required for the cut-and-redeploy benchmark in /api/position-lifespan.

alter table public.trades
  add column if not exists spot_at_assignment numeric;
