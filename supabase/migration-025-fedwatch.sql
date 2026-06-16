-- migration-025-fedwatch.sql
-- Creates the fedwatch table: latest rate-probability snapshot from
-- rateprobability.com (FedWatch-style implied Fed funds path).
-- Its Cloudflare 403s Vercel datacenter IPs, so OpenClaw scrapes it on a
-- residential IP once/day and POSTs to /api/ingest-fedwatch. /api/macro reads
-- the latest row (ORDER BY as_of DESC LIMIT 1) and runs the rate-expectations
-- math over the stored rows so date-sensitive fields stay fresh.
--
-- RLS is auto-enabled on new tables via the rls_auto_enable event trigger.
-- This is a server-only table — read by /api/macro and written by
-- /api/ingest-fedwatch, both with the service key (which bypasses RLS). No anon
-- policy is added, so the public bundle key can neither read nor write it.
--
-- Run in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS fedwatch (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  as_of         timestamptz NOT NULL,
  midpoint      numeric     NOT NULL,  -- current Fed funds midpoint (%, e.g. 3.625)
  today_rows    jsonb       NOT NULL,  -- rateprobability "today" meeting rows
  week_ago_rows jsonb,                 -- rateprobability "ago_1w" rows (optional)
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fedwatch_as_of ON fedwatch(as_of DESC);

-- Optional: keep only the last 90 rows to avoid unbounded growth.
-- DELETE FROM fedwatch
-- WHERE id NOT IN (SELECT id FROM fedwatch ORDER BY as_of DESC LIMIT 90);
