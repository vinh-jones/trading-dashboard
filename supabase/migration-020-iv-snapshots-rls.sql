-- migration-020: enable RLS on iv_snapshots — close the anon bundle write hole
--
-- migration-015 explicitly ran `ALTER TABLE iv_snapshots DISABLE ROW LEVEL
-- SECURITY;`, so the table predates the rls_auto_enable event trigger and RLS
-- was never on. The Supabase anon key ships in the public browser bundle, so
-- with RLS off anyone with that key could INSERT/UPDATE/DELETE iv_snapshots.
--
-- This is the same situation as `quotes` in migration-019 (Group B):
--
--   - Browser reads iv_snapshots directly via the anon key
--     (src/hooks/useIvTrends.js — SELECT only, no write path).
--   - The only writer, api/ingest-iv.js, uses SUPABASE_SERVICE_KEY, which
--     bypasses RLS.
--
-- So: enable RLS and add an anon SELECT-only policy. Writes stay on the
-- service-key server route.

ALTER TABLE public.iv_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read" ON public.iv_snapshots FOR SELECT TO anon USING (true);
