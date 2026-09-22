#!/usr/bin/env node
/**
 * One-time backfill of share_exposure_daily, BACKFILL_START → yesterday.
 * docs/spec_share_exposure_daily_v1.md §3. Idempotent: re-running upserts
 * identical rows (only computed_at moves).
 *
 * Uses the exact algorithm the live snapshot path uses (api/_lib/shareExposure.js).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/backfill-share-exposure.js
 *   node scripts/backfill-share-exposure.js --input <dir> --sql > upsert.sql
 *
 * --input reads positions.json, trades.json, account_snapshots.json from <dir>
 * instead of querying Supabase. --sql prints an upsert statement instead of
 * writing. Either way a summary + any §5 description conflicts go to stderr.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { BACKFILL_START, buildExposureRows } from "../api/_lib/shareExposure.js";

const args = process.argv.slice(2);
const inputDir = args.includes("--input") ? args[args.indexOf("--input") + 1] : null;
const emitSql  = args.includes("--sql");

function yesterdayISO() {
  // The live cron owns today; backfill stops the day before (ET calendar).
  const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const d = new Date(`${todayET}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function load() {
  if (inputDir) {
    const read = f => JSON.parse(fs.readFileSync(path.join(inputDir, f), "utf8"));
    return { positions: read("positions.json"), trades: read("trades.json"),
             accountRows: read("account_snapshots.json"), supabase: null };
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const [p, t, a] = await Promise.all([
    supabase.from("positions").select("*"),
    supabase.from("trades")
      .select("ticker, type, subtype, description, open_date, close_date, capital_fronted")
      .in("type", ["Shares", "LEAPS", "CSP"])
      // Newest first: if this ever hits PostgREST's 1000-row cap, the rows
      // dropped are the oldest — irrelevant to a recent gap-fill.
      .order("close_date", { ascending: false }).limit(1000),
    supabase.from("account_snapshots").select("snapshot_date, account_value"),
  ]);
  for (const r of [p, t, a]) if (r.error) throw r.error;
  if (t.data.length >= 1000) throw new Error("trades hit the 1000-row cap — paginate before backfilling");
  return { positions: p.data, trades: t.data, accountRows: a.data, supabase };
}

const sqlLit = v =>
  v == null ? "NULL"
  : typeof v === "number" ? String(v)
  : typeof v === "object" ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  : `'${String(v).replace(/'/g, "''")}'`;

const { positions, trades, accountRows, supabase } = await load();
const to = args.includes("--to") ? args[args.indexOf("--to") + 1] : yesterdayISO();
const { rows, conflicts } = buildExposureRows({ positions, trades, accountRows, from: BACKFILL_START, to });

for (const c of conflicts) {
  console.error(`WARN ${c.ticker} lot ${c.open_date}: "${c.description}" implies $${c.implied}, capital_fronted $${c.stored}`);
}
console.error(`${rows.length} rows, ${rows[0]?.snapshot_date} → ${rows.at(-1)?.snapshot_date}`);

if (emitSql) {
  const cols = Object.keys(rows[0]);
  const values = rows.map(r => `(${cols.map(c => sqlLit(r[c])).join(", ")})`).join(",\n");
  const updates = cols.filter(c => c !== "snapshot_date").map(c => `${c} = EXCLUDED.${c}`).join(", ");
  process.stdout.write(
    `INSERT INTO share_exposure_daily (${cols.join(", ")}) VALUES\n${values}\n` +
    `ON CONFLICT (snapshot_date) DO UPDATE SET ${updates}, computed_at = now();\n`);
} else {
  if (!supabase) throw new Error("--input without --sql has nowhere to write");
  const computed_at = new Date().toISOString();
  const { error } = await supabase.from("share_exposure_daily")
    .upsert(rows.map(r => ({ ...r, computed_at })), { onConflict: "snapshot_date" });
  if (error) throw error;
  console.error("upserted");
}
