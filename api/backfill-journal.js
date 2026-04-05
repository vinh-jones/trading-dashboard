/**
 * api/backfill-journal.js — Vercel serverless function
 *
 * POST /api/backfill-journal
 *
 * One-time operation: creates trade_note journal entries for every trade
 * in the trades table with open_date >= 2026-03-01, skipping any that
 * already have a matching journal entry (deduped by ticker + entry_date + title).
 *
 * Body in each created entry is empty — user fills it in via the Edit flow.
 */

import { createClient } from "@supabase/supabase-js";

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

  try {
    const supabase = getSupabase();

    // Fetch trades opened on or after 2026-03-01
    const { data: trades, error: tradesErr } = await supabase
      .from("trades")
      .select("*")
      .gte("open_date", "2026-03-01")
      .order("open_date", { ascending: true });
    if (tradesErr) throw tradesErr;

    // Fetch existing trade_note journal entries to detect duplicates
    const { data: existing, error: existErr } = await supabase
      .from("journal_entries")
      .select("ticker, entry_date, title")
      .eq("entry_type", "trade_note");
    if (existErr) throw existErr;

    // Build a Set of "ticker|entry_date|title" keys that already exist
    const existingKeys = new Set(
      (existing || []).map(e => `${e.ticker}|${e.entry_date}|${e.title}`)
    );

    const now = new Date().toISOString();

    const toInsert = [];
    for (const t of trades) {
      const title = buildTitle(t);
      const key   = `${t.ticker}|${t.open_date}|${title}`;
      if (existingKeys.has(key)) continue; // already backfilled
      toInsert.push({
        entry_type:  "trade_note",
        trade_id:    null,
        position_id: null,
        entry_date:  t.open_date,
        ticker:      t.ticker,
        title,
        body:        "",
        tags:        [],
        source:      t.source || null,
        created_at:  now,
        updated_at:  now,
      });
    }

    if (toInsert.length === 0) {
      res.status(200).json({ ok: true, created: 0, message: "Nothing new to backfill." });
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
