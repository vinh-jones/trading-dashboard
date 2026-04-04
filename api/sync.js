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
import { fetchSheetData } from "../lib/parseSheets.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const supabase = getSupabase();

    // ── 1. Fetch and parse Google Sheets ────────────────────────────────
    const { trades, positions, account } = await fetchSheetData();
    const { assigned_shares, open_csps, open_leaps } = positions;

    // ── 2. Upsert closed trades (append-only) ───────────────────────────
    const tradeRows = trades.map(t => ({
      ticker:            t.ticker,
      type:              t.type,
      subtype:           t.subtype    || null,
      description:       t.description || null,
      strike:            t.strike     ?? null,
      contracts:         t.contracts  ?? null,
      open_date:         t.open_date,
      close_date:        t.close_date,
      expiry_date:       t.expiry_date || null,
      days_held:         t.days_held  ?? null,
      premium_collected: t.premium_collected != null ? Math.round(t.premium_collected) : null,
      kept_pct:          t.kept_pct   ?? null,
      capital_fronted:   t.capital_fronted != null ? Math.round(t.capital_fronted) : null,
      source:            t.source     || "Ryan",
      notes:             t.notes      || "",
      synced_at:         new Date().toISOString(),
    }));

    if (tradeRows.length > 0) {
      const { error } = await supabase
        .from("trades")
        .upsert(tradeRows, {
          onConflict: "ticker,type,open_date,close_date,strike,contracts",
          ignoreDuplicates: false,
        });
      if (error) throw new Error(`Trades upsert failed: ${error.message}`);
    }

    // ── 3. Replace positions entirely ───────────────────────────────────
    // Delete all existing rows
    const { error: delError } = await supabase
      .from("positions")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delError) throw new Error(`Positions delete failed: ${delError.message}`);

    // Build flat rows for every position type
    const positionRows = [
      // Assigned shares — one row per ticker (lots stored as JSONB)
      ...assigned_shares.map(s => ({
        position_type: "assigned_shares",
        ticker:        s.ticker,
        type:          "Shares",
        capital_fronted: s.cost_basis_total != null ? Math.round(s.cost_basis_total) : null,
        has_active_cc: !!s.active_cc,
        lots:          s.positions,   // JSONB: [{ description, fronted }]
        notes:         s.notes || "",
        synced_at:     new Date().toISOString(),
      })),

      // Active covered calls — one row per ticker that has one
      ...assigned_shares
        .filter(s => s.active_cc)
        .map(s => ({
          position_type:     "open_csp",
          ticker:            s.active_cc.ticker,
          type:              "CC",
          strike:            s.active_cc.strike,
          contracts:         s.active_cc.contracts,
          open_date:         s.active_cc.open_date,
          expiry_date:       s.active_cc.expiry_date,
          days_to_expiry:    s.active_cc.days_to_expiry,
          premium_collected: s.active_cc.premium_collected != null ? Math.round(s.active_cc.premium_collected) : null,
          capital_fronted:   s.active_cc.capital_fronted  != null ? Math.round(s.active_cc.capital_fronted)  : null,
          source:            s.active_cc.source || "Ryan",
          notes:             s.active_cc.notes  || "",
          synced_at:         new Date().toISOString(),
        })),

      // LEAPS nested inside assigned shares
      ...assigned_shares.flatMap(s =>
        (s.open_leaps || []).map(l => ({
          position_type:   "open_leaps",
          ticker:          l.ticker,
          type:            "LEAPS",
          subtype:         l.subtype || "Held",
          description:     l.description || null,
          open_date:       l.open_date,
          capital_fronted: l.capital_fronted != null ? Math.round(l.capital_fronted) : null,
          source:          l.source || "Ryan",
          notes:           l.notes  || "",
          synced_at:       new Date().toISOString(),
        }))
      ),

      // Open CSPs
      ...open_csps.map(c => ({
        position_type:     "open_csp",
        ticker:            c.ticker,
        type:              "CSP",
        strike:            c.strike,
        contracts:         c.contracts,
        open_date:         c.open_date,
        expiry_date:       c.expiry_date,
        days_to_expiry:    c.days_to_expiry,
        premium_collected: c.premium_collected != null ? Math.round(c.premium_collected) : null,
        capital_fronted:   c.capital_fronted   != null ? Math.round(c.capital_fronted)   : null,
        source:            c.source || "Ryan",
        notes:             c.notes  || "",
        synced_at:         new Date().toISOString(),
      })),

      // Standalone LEAPS (not nested in any assigned share)
      ...open_leaps.map(l => ({
        position_type:   "open_leaps",
        ticker:          l.ticker,
        type:            "LEAPS",
        subtype:         l.subtype || "Held",
        description:     l.description || null,
        open_date:       l.open_date,
        capital_fronted: l.capital_fronted != null ? Math.round(l.capital_fronted) : null,
        source:          l.source || "Ryan",
        notes:           l.notes  || "",
        synced_at:       new Date().toISOString(),
      })),
    ];

    if (positionRows.length > 0) {
      const { error } = await supabase.from("positions").insert(positionRows);
      if (error) throw new Error(`Positions insert failed: ${error.message}`);
    }

    // ── 4. Upsert today's account snapshot ──────────────────────────────
    const TODAY = new Date().toISOString().slice(0, 10);
    const { error: snapError } = await supabase
      .from("account_snapshots")
      .upsert({
        snapshot_date:         TODAY,
        account_value:         account.account_value,
        cost_basis:            account.cost_basis,
        free_cash_est:         account.free_cash_est,
        free_cash_pct_est:     account.free_cash_pct_est,
        month_to_date_premium: account.month_to_date_premium,
        current_month:         account.current_month,
        current_year:          account.year,
        synced_at:             new Date().toISOString(),
      }, { onConflict: "snapshot_date" });
    if (snapError) throw new Error(`Snapshot upsert failed: ${snapError.message}`);

    res.status(200).json({
      ok:             true,
      tradesCount:    tradeRows.length,
      positionsCount: positionRows.length,
    });
  } catch (err) {
    console.error("[api/sync] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}
