-- Migration 001: Add metadata JSONB column to journal_entries
-- Run once in the Supabase SQL editor.
--
-- This column stores a point-in-time snapshot of portfolio state for EOD Update entries.
-- Schema is defined in code (computeEodMetadata in App.jsx) and evolves without further migrations.
-- Non-EOD entries leave this column NULL.

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS metadata JSONB;
