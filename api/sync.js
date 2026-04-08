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
      supabase.from("journal_entries")
        .select("id, ticker, entry_date, title, trade_id, body")
        .eq("entry_type", "trade_note"),
    ]);

    // Primary dedup: by trade_id (stable across close_date changes).
    // Fallback: key-based dedup for legacy entries that pre-date this fix (trade_id = null).
    const existingByTradeId = new Map(
      (existing || []).filter(e => e.trade_id).map(e => [e.trade_id, e])
    );
    const stripPct = s => s.replace(/\s*\(\d+%\)$/, "");
    const existingKeys = new Set(
      (existing || []).filter(e => !e.trade_id).map(e => `${e.ticker}|${e.entry_date}|${stripPct(e.title)}`)
    );
    const now = new Date().toISOString();

    const toInsert = [];
    const toUpdate = []; // entries whose entry_date/title drifted (e.g. early exit filled in later)

    for (const t of trades || []) {
      const entryDate = t.close_date || t.open_date;
      const title = buildTitle(t);

      const existingEntry = existingByTradeId.get(t.id);
      if (existingEntry) {
        // Trade already has a journal entry. If close_date changed (early exit recorded
        // after the fact) and the entry hasn't been annotated yet, correct the date + title.
        if (existingEntry.body === "" &&
            (existingEntry.entry_date !== entryDate || existingEntry.title !== title)) {
          toUpdate.push({ id: existingEntry.id, entry_date: entryDate, title });
        }
        continue;
      }

      // Legacy fallback for entries without a trade_id (created before this fix)
      const key = `${t.ticker}|${entryDate}|${stripPct(title)}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key); // prevent same-sync dupes from duplicate trade rows
      toInsert.push({
        entry_type:  "trade_note",
        trade_id:    t.id,
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

    // ── Auto-journal: also cover open positions (LEAPS, CSPs, CCs) ──
    // Positions only exist in the positions table (not trades), so they'd
    // never get a journal entry without this second pass.
    const { data: openPositions } = await supabase
      .from("positions")
      .select("ticker, type, strike, open_date, source")
      .gte("open_date", JOURNAL_CUTOFF);

    for (const p of openPositions || []) {
      const title = buildTitle(p); // close_date absent → "TYPE $XX — Opened"
      const key = `${p.ticker}|${p.open_date}|${title}`;
      if (!existingKeys.has(key)) {
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
    }

    if (toInsert.length > 0) {
      await supabase.from("journal_entries").insert(toInsert);
    }
    for (const upd of toUpdate) {
      await supabase.from("journal_entries")
        .update({ entry_date: upd.entry_date, title: upd.title, updated_at: now })
        .eq("id", upd.id);
    }

    res.status(200).json({ ok: true, tradesCount, positionsCount, journalCreated: toInsert.length, journalUpdated: toUpdate.length });
  } catch (err) {
    console.error("[api/sync] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}
