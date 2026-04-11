-- migration-004-app-cache.sql
-- Generic key-value cache for server-side state (e.g. Public.com bearer token)

CREATE TABLE IF NOT EXISTS app_cache (
  key        text        PRIMARY KEY,
  value      text        NOT NULL,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_cache DISABLE ROW LEVEL SECURITY;
