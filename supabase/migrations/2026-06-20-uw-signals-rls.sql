-- uw_signals is market data (no PII), read by the SPA via the anon key. Mirror
-- the read access that quotes/wheel_universe have so the frontend can see it:
-- explicit SELECT grant + RLS with an anon-read policy. Writes stay
-- service-role only (the ingestion job), which bypasses RLS.
--
-- Without this the browser's anon client gets zero rows and the Whale CSP flow
-- panel + entry-score gamma/flow modifiers silently no-op.

grant select on public.uw_signals to anon, authenticated;

alter table public.uw_signals enable row level security;

create policy "anon read" on public.uw_signals
  for select to anon using (true);
