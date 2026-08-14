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
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  // Writes trades/positions/account_snapshots/daily_snapshots/journal_entries —
  // all RLS-locked. Must use the service role. Anon fallback is local dev only.
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

const JOURNAL_CUTOFF = "2026-03-01";

/**
 * A synthetic share ACQUISITION (direct buy, or the assigned-shares placeholder)
 * is written to the trades table with close_date = open_date so it shows up in
 * the lifespan UI — but it is not a close. The assigned_shares lots loop journals
 * these as "Shares — Opened", so the trades→journal loop must skip them to avoid
 * emitting a misleading duplicate "Shares $X — Closed MM/DD" card. Genuine share
 * SALES (subtype 'Sold') are real closes and keep their card.
 */
export function isSyntheticShareAcquisition(trade) {
  return trade.type === "Shares" && trade.subtype === "Assigned";
}

export function buildTitle(trade) {
  const strikeStr = trade.strike ? ` $${trade.strike}` : "";
  const keptStr   = trade.kept_pct != null ? ` (${Math.round(trade.kept_pct * 100)}%)` : "";
  if (trade.close_date) {
    const closeFmt = trade.close_date.slice(5).replace("-", "/");
    return `${trade.type}${strikeStr} — Closed ${closeFmt}${keptStr}`;
  }
  return `${trade.type}${strikeStr} — Opened`;
}

/**
 * Plan the trades→journal pass: which trades still need a journal entry, and
 * which existing entries drifted (e.g. an early exit recorded after the fact).
 *
 * Dedup is by trade_id, which is stable across close_date changes. Entries that
 * pre-date trade_id fall back to a natural key (ticker|date|title-without-%).
 * That fallback is COUNTED, not a plain set: two share lots of the same ticker
 * closed on the same day produce the identical key, so one legacy entry may only
 * cover one of them. Treating the key as a set let the first lot's entry mask
 * every other lot behind it, and those lots were then never journaled at all.
 *
 * Returns `seenKeys` so the open-position and share-lot passes — which have no
 * trade_id to dedup on — don't re-journal a trade this pass already covered.
 */
export function planTradeJournalEntries({ trades, existing, now }) {
  const stripPct = s => (s ?? "").replace(/\s*\(\d+%\)$/, "");
  const naturalKey = (ticker, entryDate, title) => `${ticker}|${entryDate}|${stripPct(title)}`;

  const existingByTradeId = new Map(
    (existing || []).filter(e => e.trade_id).map(e => [e.trade_id, e])
  );
  const legacyKeyCounts = new Map();
  for (const e of existing || []) {
    if (e.trade_id) continue;
    const k = naturalKey(e.ticker, e.entry_date, e.title);
    legacyKeyCounts.set(k, (legacyKeyCounts.get(k) ?? 0) + 1);
  }
  const seenKeys = new Set(legacyKeyCounts.keys());

  const toInsert = [];
  const toUpdate = [];

  for (const t of trades || []) {
    // Share acquisitions carry close_date = open_date but aren't closes; the
    // assigned_shares lots loop already journals them as "Shares — Opened".
    if (isSyntheticShareAcquisition(t)) continue;

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

    // Consume one legacy entry per matching trade, so trades sharing a key each
    // get covered exactly once instead of all collapsing into the first.
    const key = naturalKey(t.ticker, entryDate, title);
    const legacyCount = legacyKeyCounts.get(key) ?? 0;
    if (legacyCount > 0) {
      legacyKeyCounts.set(key, legacyCount - 1);
      continue;
    }

    // Only guards the position/lot passes below — trades dedup on trade_id, so a
    // second trade sharing this key still gets its own entry.
    seenKeys.add(key);
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

  return { toInsert, toUpdate, seenKeys };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const supabase = getSupabase();
    const TODAY = new Date().toISOString().slice(0, 10);
    const { tradesCount, positionsCount, tradesMerged } = await syncFromSheets(supabase);

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

    const now = new Date().toISOString();
    // toUpdate: entries whose entry_date/title drifted (e.g. early exit filled in later)
    const { toInsert, toUpdate, seenKeys: existingKeys } =
      planTradeJournalEntries({ trades, existing, now });

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

    // ── Auto-journal: assigned shares — one entry per lot ──────────────────
    // assigned_shares position rows have no open_date (NULL), so they're
    // excluded by the .gte("open_date", ...) query above. Read their lots
    // JSONB directly — each lot now carries its own open_date.
    const { data: sharePositions } = await supabase
      .from("positions")
      .select("ticker, lots, source")
      .eq("position_type", "assigned_shares");

    for (const sp of sharePositions || []) {
      for (const lot of (sp.lots || [])) {
        if (!lot.open_date || lot.open_date < JOURNAL_CUTOFF) continue;
        const title = "Shares — Opened";
        const key   = `${sp.ticker}|${lot.open_date}|${title}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          toInsert.push({
            entry_type:  "trade_note",
            trade_id:    null,
            position_id: null,
            entry_date:  lot.open_date,
            ticker:      sp.ticker,
            title,
            body:        "",
            tags:        [],
            source:      sp.source || null,
            created_at:  now,
            updated_at:  now,
          });
        }
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
      tradesMerged,
      journalCreated: toInsert.length,
      journalUpdated: toUpdate.length,
      forecastRefresh,
    });
  } catch (err) {
    console.error("[api/sync] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}
