-- migration-010: sent_alerts table for Pushover notification dedup
-- Run in Supabase SQL Editor
--
-- Used by /api/snapshot's EOD alert step: before sending a push for a
-- Focus Engine P1 item, we check whether (alert_id, today) already exists
-- here, and skip if so. Prevents duplicate pushes on cron retries and keeps
-- the door open for future intraday cadence.

CREATE TABLE IF NOT EXISTS sent_alerts (
  alert_id  text        NOT NULL,
  sent_date date        NOT NULL,
  sent_at   timestamptz DEFAULT now(),
  title     text,
  PRIMARY KEY (alert_id, sent_date)
);
