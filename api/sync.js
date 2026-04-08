/**
 * api/sync.js — Vercel serverless function
 * POST /api/sync
 *
 * Fetches all three Google Sheets tabs and writes to Supabase:
 *   - Upserts closed trades (append-only)
 *   - Replaces open positions entirely
 *   - Upserts today's account snapshot
 *
 * Called by the Sync Sheet button in production.
 */

import { createClient } from "@supabase/supabase-js";
import { syncFromSheets } from "../lib/syncSheets.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

const JOURNAL_CUTOFF = "2026-03-01";

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
    const { tradesCount, positionsCount } = await syncFromSheets(supabase);

    // ── Auto-journal: insert entries for any trades not yet journaled ──
    const [{ data: trades }, { data: existing }] = await Promise.all([
      supabase.from("trades").select("*").gte("open_date", JOURNAL_CUTOFF),
      supabase.from("journal_entries").select("ticker, entry_date, title").eq("entry_type", "trade_note"),
    ]);

    const stripPct = s => s.replace(/\s*\(\d+%\)$/, "");
    const existingKeys = new Set(
      (existing || []).map(e => `${e.ticker}|${e.entry_date}|${stripPct(e.title)}`)
    );
    const now = new Date().toISOString();

    const toInsert = (trades || []).reduce((acc, t) => {
      const entryDate = t.close_date || t.open_date;
      const title = buildTitle(t);
      const key = `${t.ticker}|${entryDate}|${stripPct(title)}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key); // prevent same-sync duplicates from duplicate trade rows
        acc.push({
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
      return acc;
    }, []);

    if (toInsert.length > 0) {
      await supabase.from("journal_entries").insert(toInsert);
    }

    res.status(200).json({ ok: true, tradesCount, positionsCount, journalCreated: toInsert.length });
  } catch (err) {
    console.error("[api/sync] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}
