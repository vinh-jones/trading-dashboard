-- migration-022-tag-usage-stats-security-definer.sql
-- tag_usage_stats reads public.journal_entries. It runs as a SECURITY INVOKER
-- function (i.e. as the calling anon role), so it only works while anon has a
-- SELECT policy on journal_entries. migration-023 drops that policy to close
-- the journal exposure (reads now go through the APP_SECRET-gated
-- /api/journal-entry endpoint). To keep the tag-usage RPC working after the
-- policy is gone, recreate it as SECURITY DEFINER so it runs with the function
-- owner's privileges and bypasses RLS for this read-only aggregate.
--
-- Safe because: search_path is pinned to '' and the body schema-qualifies
-- public.journal_entries, so a definer function cannot be hijacked via
-- search_path. The function is read-only (STABLE, SELECT/GROUP BY only).
-- Apply this BEFORE migration-023.

CREATE OR REPLACE FUNCTION public.tag_usage_stats(from_date timestamp with time zone, to_date timestamp with time zone)
 RETURNS TABLE(tag text, category text, count bigint)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
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

-- CREATE OR REPLACE preserves existing grants, but make the anon EXECUTE grant
-- explicit and self-documenting (the client calls this via supabase.rpc).
GRANT EXECUTE ON FUNCTION public.tag_usage_stats(timestamp with time zone, timestamp with time zone) TO anon;
