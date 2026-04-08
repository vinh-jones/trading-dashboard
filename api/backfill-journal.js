/**
 * api/backfill-journal.js — Vercel serverless function
 *
 * POST /api/backfill-journal          → add missing entries, skip existing
 * POST /api/backfill-journal?resync=1 → delete all empty-body backfilled entries
 *                                       in range, then re-insert with correct dates
 *
 * Entry date logic:
 *   - Closed trade (has close_date) → entry_date = close_date
 *   - Still open (no close_date)    → entry_date = open_date
 *
 * Dedup key: ticker + entry_date + title (safe to run multiple times).
 * Re-sync only deletes entries where body = '' (not yet annotated by user).
 */

import { createClient } from "@supabase/supabase-js";

const BACKFILL_FROM = "2026-03-01";

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

function buildTitle(trade) {
  const strikeStr = trade.strike ? ` $${trade.strike}` : "";
  const keptStr   = trade.kept_pct != null ? ` (${Math.round(trade.kept_pct * 100)}%)` : "";
  if (trade.close_date) {
    const closeFmt = trade.close_date.slice(5).replace("-", "/");
    return `${trade.type}${strikeStr} — Closed ${closeFmt}${keptStr}`;
  }
  return `${trade.type}${strikeStr} — Opened`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const resync = req.query.resync === "1";

  try {
    const supabase = getSupabase();

    // ── Re-sync: delete all empty-body backfilled entries first ──
    if (resync) {
      const { error: delErr } = await supabase
        .from("journal_entries")
        .delete()
        .eq("entry_type", "trade_note")
        .eq("body", "")
        .gte("entry_date", BACKFILL_FROM);
      if (delErr) throw delErr;
    }

    // ── Fetch trades opened on or after BACKFILL_FROM ──
    const { data: trades, error: tradesErr } = await supabase
      .from("trades")
      .select("*")
      .gte("open_date", BACKFILL_FROM)
      .order("open_date", { ascending: true });
    if (tradesErr) throw tradesErr;

    // ── Fetch existing trade_note entries to dedup ──
    const { data: existing, error: existErr } = await supabase
      .from("journal_entries")
      .select("ticker, entry_date, title")
      .eq("entry_type", "trade_note");
    if (existErr) throw existErr;

    const stripPct = s => s.replace(/\s*\(\d+%\)$/, "");
    const existingKeys = new Set(
      (existing || []).map(e => `${e.ticker}|${e.entry_date}|${stripPct(e.title)}`)
    );

    const now = new Date().toISOString();

    const toInsert = [];
    for (const t of trades) {
      // Use close_date for closed trades, open_date for positions still open
      const entryDate = t.close_date || t.open_date;
      const title     = buildTitle(t);
      const key       = `${t.ticker}|${entryDate}|${stripPct(title)}`;
      if (existingKeys.has(key)) continue; // already exists
      existingKeys.add(key);
      toInsert.push({
        entry_type:  "trade_note",
        trade_id:    null,
        position_id: null,
        entry_date:  entryDate,
        ticker:      t.ticker,
        title,
        body:        "",
        tags:        [],
        source:      t.source || null,
        created_at:  now,
        updated_at:  now,
      });
    }

    // ── Also cover open positions (LEAPS, CSPs, CCs) not in trades table ──
    const { data: openPositions, error: posErr } = await supabase
      .from("positions")
      .select("ticker, type, strike, open_date, source")
      .gte("open_date", BACKFILL_FROM)
      .order("open_date", { ascending: true });
    if (posErr) throw posErr;

    for (const p of openPositions || []) {
      const title = buildTitle(p); // no close_date → "TYPE $XX — Opened"
      const key   = `${p.ticker}|${p.open_date}|${title}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      toInsert.push({
        entry_type:  "trade_note",
        trade_id:    null,
        position_id: null,
        entry_date:  p.open_date,
        ticker:      p.ticker,
        title,
        body:        "",
        tags:        [],
        source:      p.source || null,
        created_at:  now,
        updated_at:  now,
      });
    }

    if (toInsert.length === 0) {
      res.status(200).json({ ok: true, created: 0, deleted: resync, message: "Nothing new to backfill." });
      return;
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("journal_entries")
      .insert(toInsert)
      .select();
    if (insertErr) throw insertErr;

    res.status(200).json({ ok: true, created: inserted.length });
  } catch (err) {
    console.error("[api/backfill-journal] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}
