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
import { getVixBand } from "../src/lib/vixBand.js";
import {
  computeForecastV2,
  serializePerPosition,
  buildPositionStateRows,
} from "./_lib/computeForecastV2.js";

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
    const TODAY = new Date().toISOString().slice(0, 10);
    const { tradesCount, positionsCount } = await syncFromSheets(supabase);

    // Patch account_snapshots with live VIX — syncFromSheets doesn't have it
    // (sheets don't carry VIX). Non-blocking: a fetch failure here never fails the sync.
    try {
      const vixRes = await fetch(
        "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=1d",
        { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "application/json" } }
      );
      if (vixRes.ok) {
        const vixData = await vixRes.json();
        const vix = vixData?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
        if (vix != null) {
          const band = getVixBand(vix);
          await supabase.from("account_snapshots")
            .update({ vix_current: vix, vix_band: band?.label ?? null })
            .eq("snapshot_date", TODAY);
        }
      }
    } catch { /* non-blocking */ }

    // ── Auto-journal: insert entries for any trades not yet journaled ──
    const [{ data: trades }, { data: existing }] = await Promise.all([
      supabase.from("trades").select("*").or(`open_date.gte.${JOURNAL_CUTOFF},close_date.gte.${JOURNAL_CUTOFF}`),
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

    // ── Refresh v2 pipeline forecast on today's daily_snapshots row ─────────
    // The EOD /api/snapshot cron is the canonical writer of daily_snapshots
    // (VIX/SPY/QQQ/bands/macro/alerts). Sync only updates forecast fields so
    // mid-day edits in the sheet re-flow into the dashboard's pipeline
    // section. Non-blocking — a forecast failure never fails the sync.
    let forecastRefresh = null;
    try {
      const today = new Date().toISOString().split("T")[0];
      const [accountResult, positionsResult] = await Promise.all([
        supabase.from("account_snapshots")
          .select("vix_current")
          .order("snapshot_date", { ascending: false })
          .limit(1)
          .single(),
        supabase.from("positions").select("*"),
      ]);
      const vix       = accountResult.data?.vix_current ?? null;
      const positions = positionsResult.data ?? [];

      const { forecastV2, positionStatesForWrite } = await computeForecastV2({
        supabase, today, vix, positions,
      });

      // Narrow update: only v2-forecast columns. Preserves VIX/SPY/QQQ/band
      // fields written by the EOD cron. If today's row doesn't exist yet
      // (first sync of the day), upsert a partial row — NOT NULL columns on
      // daily_snapshots are only `snapshot_date`, so partial inserts are OK.
      const forecastRow = {
        snapshot_date:                 today,
        forecast_realized_to_date:     forecastV2?.forecast_realized_to_date     ?? null,
        forecast_this_month_remaining: forecastV2?.forecast_this_month_remaining ?? null,
        forecast_this_month_std:       forecastV2?.forecast_this_month_std       ?? null,
        forecast_month_total:          forecastV2?.forecast_month_total          ?? null,
        forecast_target_gap:           forecastV2?.forecast_target_gap           ?? null,
        forward_pipeline_premium:      forecastV2?.forward_pipeline_premium      ?? null,
        csp_pipeline_premium:          forecastV2?.csp_pipeline_premium          ?? null,
        cc_pipeline_premium:           forecastV2?.cc_pipeline_premium           ?? null,
        below_cost_cc_premium:         forecastV2?.below_cost_cc_premium         ?? null,
        pipeline_phase:                forecastV2?.pipeline_phase                ?? null,
        forecast_per_position:         forecastV2 ? serializePerPosition(forecastV2.per_position) : null,
      };
      const { error: fcErr } = await supabase
        .from("daily_snapshots")
        .upsert(forecastRow, { onConflict: "snapshot_date" });
      if (fcErr) throw fcErr;

      if (positionStatesForWrite.length > 0) {
        const stateRows = buildPositionStateRows({ positionStates: positionStatesForWrite, today });
        const { error: stateErr } = await supabase
          .from("position_daily_state")
          .upsert(stateRows, { onConflict: "snapshot_date,position_key" });
        if (stateErr) console.error("[api/sync] position_daily_state write failed:", stateErr);
      }

      forecastRefresh = {
        month_total:  forecastV2?.forecast_month_total     ?? null,
        forward:      forecastV2?.forward_pipeline_premium ?? null,
      };
    } catch (fcErr) {
      console.error("[api/sync] Forecast refresh failed (non-blocking):", fcErr.message);
    }

    res.status(200).json({
      ok: true,
      tradesCount,
      positionsCount,
      journalCreated: toInsert.length,
      journalUpdated: toUpdate.length,
      forecastRefresh,
    });
  } catch (err) {
    console.error("[api/sync] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}
