-- Decision-attribution log (finance review cross-cutting #3): a daily snapshot
-- of what the signals recommended on each open CSP, so the monthly review can
-- later show which signals actually diverged from what was done — and prune the
-- ones that never change a decision. Written by the client when Open Positions
-- is viewed (the signal state at decision-viewing time), upserted once per
-- position per day. One row per (logged_date, position_key).
--
-- Idempotent: re-running is a no-op.

create table if not exists public.signal_log (
  logged_date      date    not null,
  position_key     text    not null,
  ticker           text,
  redeploy_state   text,   -- raw redeploy ratio state (hold/watch/redeploy/underwater)
  overlay_state    text,   -- final recommendation after flow + hard-rule precedence
  assignment_level text,   -- none/watch/elevated/high
  hard_close       boolean,-- a take-profit tier or cushion rule said close
  gex_env          text,   -- stabilized/choppy/neutral
  flow_streak      integer,-- signed daily-close flow streak at log time
  created_at       timestamptz default now(),
  primary key (logged_date, position_key)
);
