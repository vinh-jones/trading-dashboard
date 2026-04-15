-- migration-011: alert_state table for transition-based Focus Engine push dedup
-- Run in Supabase SQL Editor
--
-- Complements sent_alerts (which is per-day dedup). This table tracks
-- currently-outstanding alerts: one row per alert_id that is actively firing
-- and has already been pushed. Inserted when a rule transitions from
-- not-firing → firing, deleted when it resolves. As long as the row exists,
-- the alert is considered "still firing, already notified" and no new push
-- is sent — even across days. This matches the UX goal of pushing once per
-- condition-onset rather than once per day while the condition persists.
--
-- sent_alerts is kept for ops-alerts (429/403/401 from Public.com), which
-- still want per-day dedup semantics.

CREATE TABLE IF NOT EXISTS alert_state (
  alert_id       text        NOT NULL PRIMARY KEY,
  first_fired_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  title          text
);
