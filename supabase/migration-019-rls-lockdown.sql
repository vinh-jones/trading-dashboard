-- migration-019: RLS lockdown — stop the public anon bundle key mutating data
--
-- The Supabase anon key ships in the public browser bundle. Every table below
-- had a single "Allow all" policy (FOR ALL, roles=public, USING true) — meaning
-- anyone with the public key could INSERT/UPDATE/DELETE personal financial data.
--
-- Server routes that previously used the anon key (data.js, sync.js,
-- delete-trade.js) and the new journal-entry.js / radar-preset.js routes now
-- use SUPABASE_SERVICE_KEY, which bypasses RLS. So:
--
--   Group A — no browser-direct access at all → drop policy, NO anon policy.
--   Group B — browser reads directly via anon key → anon SELECT only.
--
-- Run in the Supabase SQL editor (RLS is already enabled on all of these via
-- the rls_auto_enable event trigger).

-- ── Group A: server-only tables — remove all anon/public access ───────────────
-- (service_role bypasses RLS; no policy = deny for anon)
DROP POLICY IF EXISTS "Allow all" ON trades;
DROP POLICY IF EXISTS "Allow all" ON positions;
DROP POLICY IF EXISTS "Allow all" ON account_snapshots;
DROP POLICY IF EXISTS "Allow all" ON daily_snapshots;
DROP POLICY IF EXISTS "Allow all" ON roll_analysis;
DROP POLICY IF EXISTS "Allow all" ON macro_snapshots;

-- ── Group B: browser reads these directly via the anon bundle key ─────────────
-- Replace "Allow all" (FOR ALL) with anon SELECT only. Writes go through
-- service-key server routes.
DROP POLICY IF EXISTS "Allow all" ON wheel_universe;
CREATE POLICY "anon read" ON wheel_universe FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow all" ON fundamentals;
CREATE POLICY "anon read" ON fundamentals FOR SELECT TO anon USING (true);

-- NOTE: quotes predates the rls_auto_enable event trigger, so RLS was never
-- enabled on it — its old "Allow all" policy was never enforced (table was
-- effectively wide open). Enable RLS so the SELECT-only policy below takes
-- effect. All quotes writers (bb.js, ingest-iv.js, eod-snapshot.js, etc.) use
-- the service key, which bypasses RLS.
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON quotes;
CREATE POLICY "anon read" ON quotes FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow all" ON tag_vocabulary;
CREATE POLICY "anon read" ON tag_vocabulary FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow all" ON journal_entries;
CREATE POLICY "anon read" ON journal_entries FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow all" ON radar_presets;
CREATE POLICY "anon read" ON radar_presets FOR SELECT TO anon USING (true);

-- ── rls_auto_enable(): silence the SECURITY DEFINER advisor ───────────────────
-- It is an event-trigger function (RETURNS event_trigger) and cannot be invoked
-- via PostgREST /rpc — the anon EXECUTE grant is just Postgres's default
-- PUBLIC:EXECUTE and is not an actual exposure. Revoke it anyway to clear the
-- advisor; the event trigger itself keeps working (it runs as the trigger owner).
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
