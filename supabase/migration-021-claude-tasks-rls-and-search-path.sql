-- migration-021: lock down claude_tasks + pin tag_usage_stats search_path
--
-- Two DB-layer hardening fixes flagged by the Supabase security advisor.
--
-- (1) claude_tasks: had a PERMISSIVE policy "Allow all access to claude_tasks"
--     (FOR ALL, roles=public, USING true, WITH CHECK true) — the public anon
--     bundle key could READ/INSERT/UPDATE/DELETE rows. The table is NOT
--     referenced anywhere in the app (no client code, no server route, no
--     migration creates it — it is external agent/task tooling). RLS is
--     already enabled on the table, so dropping the policy denies anon
--     entirely. service_role (used by all server routes) bypasses RLS, so
--     any legitimate server-side access path is unaffected. This is the same
--     Group A pattern as trades/positions/etc. in migration-019.
--     Clears advisor lint 0024_permissive_rls_policy.
--
-- (2) tag_usage_stats: function had a mutable search_path. Pin it to '' and
--     schema-qualify journal_entries. The function is plain STABLE SQL (not
--     SECURITY DEFINER) and runs as the invoker, so RLS on journal_entries
--     still applies exactly as before; CREATE OR REPLACE preserves the
--     existing anon EXECUTE grant, so the client RPC (src/lib/tags.js) keeps
--     working unchanged. Clears advisor lint 0011_function_search_path_mutable.
--
-- NOT CHANGED — journal_entries "anon read" (SELECT, anon, USING true):
--     This policy is load-bearing. Canonical client components read
--     journal_entries directly via the anon bundle key
--     (src/components/journal/JournalTab.jsx, src/components/OpenPositionsTab.jsx,
--     src/lib/tags.js) and api/journal-entry.js documents that the architecture
--     depends on anon SELECT (writes are already routed through the service-key
--     server route). Dropping the policy here would silently break the journal
--     UI. The personal trading journal SHOULD be moved behind an authed server
--     endpoint, but that is a separate, larger change and is out of scope for
--     this migration. Documented here so the exposure is tracked, not lost.
--     (The security advisor does not flag this — SELECT USING true is
--     intentionally excluded from lint 0024.)

-- ── (1) claude_tasks: remove the wide-open public policy ──────────────────────
-- RLS is already enabled; no policy => deny-all for anon. service_role bypasses.
DROP POLICY IF EXISTS "Allow all access to claude_tasks" ON public.claude_tasks;

-- ── (2) tag_usage_stats: pin search_path, schema-qualify the table ────────────
CREATE OR REPLACE FUNCTION public.tag_usage_stats(
  from_date timestamp with time zone,
  to_date   timestamp with time zone
)
RETURNS TABLE(tag text, category text, count bigint)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT
    t.tag,
    split_part(t.tag, ':', 1) AS category,
    COUNT(*) AS count
  FROM public.journal_entries,
       unnest(tags) AS t(tag)
  WHERE (from_date IS NULL OR created_at >= from_date)
    AND (to_date   IS NULL OR created_at <= to_date)
  GROUP BY t.tag
  ORDER BY count DESC;
$function$;
