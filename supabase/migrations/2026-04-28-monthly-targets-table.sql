-- monthly_targets: per-month premium targets.
-- Migrated from the hardcoded src/lib/monthlyTargets.js (baseline 15k, stretch 25k).
-- Seeded with 2026 defaults. Update specific rows via Supabase dashboard to
-- adjust targets for individual months without a code deploy.

create table if not exists public.monthly_targets (
  year        integer     not null,
  month       integer     not null check (month >= 1 and month <= 12),
  baseline    numeric     not null,
  stretch     numeric     not null,
  notes       text,
  created_at  timestamptz not null default now(),
  primary key (year, month)
);

-- Seed 2026 with current defaults from monthlyTargets.js
insert into public.monthly_targets (year, month, baseline, stretch, notes) values
  (2026,  1, 15000, 25000, 'default'),
  (2026,  2, 15000, 25000, 'default'),
  (2026,  3, 15000, 25000, 'default'),
  (2026,  4, 15000, 25000, 'default'),
  (2026,  5, 15000, 25000, 'default'),
  (2026,  6, 15000, 25000, 'default'),
  (2026,  7, 15000, 25000, 'default'),
  (2026,  8, 15000, 25000, 'default'),
  (2026,  9, 15000, 25000, 'default'),
  (2026, 10, 15000, 25000, 'default'),
  (2026, 11, 15000, 25000, 'default'),
  (2026, 12, 15000, 25000, 'default')
on conflict (year, month) do nothing;
