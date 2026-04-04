/**
 * api/data.js — Vercel serverless function
 *
 * GET /api/data
 *
 * Reads the latest data from Supabase and returns it in the same shape
 * the React app expects. Fast — no Google Sheets fetch.
 *
 * To sync fresh data from Google Sheets, call POST /api/sync first.
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

/**
 * Converts a flat array of position rows from Supabase back into the nested
 * shape that OpenPositionsTab, allocation chart, and pipeline calculator expect:
 *   { assigned_shares: [...], open_csps: [...], open_leaps: [...] }
 */
function reshapePositions(rows) {
  const assignedRows = rows.filter(r => r.position_type === "assigned_shares");
  const ccRows       = rows.filter(r => r.position_type === "open_csp" && r.type === "CC");
  const cspRows      = rows.filter(r => r.position_type === "open_csp" && r.type === "CSP");
  const leapRows     = rows.filter(r => r.position_type === "open_leaps");

  const assigned_shares = assignedRows.map(r => {
    const activeCC    = ccRows.find(cc => cc.ticker === r.ticker) || null;
    const tickerLeaps = leapRows.filter(l => l.ticker === r.ticker);
    return {
      ticker:          r.ticker,
      cost_basis_total: r.capital_fronted,
      positions:       r.lots || [],   // lots is JSONB: [{ description, fronted }]
      active_cc: activeCC ? {
        ticker:            activeCC.ticker,
        type:              activeCC.type,
        strike:            activeCC.strike,
        contracts:         activeCC.contracts,
        open_date:         activeCC.open_date,
        expiry_date:       activeCC.expiry_date,
        days_to_expiry:    activeCC.days_to_expiry,
        premium_collected: activeCC.premium_collected,
        capital_fronted:   activeCC.capital_fronted,
        source:            activeCC.source,
        notes:             activeCC.notes,
      } : null,
      open_leaps: tickerLeaps.map(l => ({
        ticker:          l.ticker,
        type:            l.type,
        subtype:         l.subtype || "Held",
        description:     l.description,
        open_date:       l.open_date,
        capital_fronted: l.capital_fronted,
        source:          l.source,
        notes:           l.notes,
      })),
      notes: r.notes || "",
    };
  });

  const assignedTickers = new Set(assigned_shares.map(s => s.ticker));

  const open_csps = cspRows.map(r => ({
    ticker:            r.ticker,
    type:              r.type,
    strike:            r.strike,
    contracts:         r.contracts,
    open_date:         r.open_date,
    expiry_date:       r.expiry_date,
    days_to_expiry:    r.days_to_expiry,
    premium_collected: r.premium_collected,
    capital_fronted:   r.capital_fronted,
    source:            r.source,
    notes:             r.notes,
  }));

  // Standalone LEAPS only (tickers NOT in assigned_shares)
  const open_leaps = leapRows
    .filter(l => !assignedTickers.has(l.ticker))
    .map(l => ({
      ticker:          l.ticker,
      type:            l.type,
      subtype:         l.subtype || "Held",
      description:     l.description,
      open_date:       l.open_date,
      capital_fronted: l.capital_fronted,
      source:          l.source,
      notes:           l.notes,
    }));

  return { assigned_shares, open_csps, open_leaps };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const supabase = getSupabase();
    const TODAY    = new Date().toISOString().slice(0, 10);

    // Fetch all three in parallel
    const [tradesResult, positionsResult, snapshotResult] = await Promise.all([
      supabase.from("trades").select("*").order("close_date", { ascending: true }),
      supabase.from("positions").select("*").order("ticker"),
      supabase
        .from("account_snapshots")
        .select("*")
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .single(),
    ]);

    if (tradesResult.error)   throw new Error(`Trades: ${tradesResult.error.message}`);
    if (positionsResult.error) throw new Error(`Positions: ${positionsResult.error.message}`);
    // snapshotResult.error is allowed (PGRST116 = no rows yet)

    const tradeRows    = tradesResult.data   ?? [];
    const positionRows = positionsResult.data ?? [];
    const snapshot     = snapshotResult.data  ?? null;

    // Map trade rows — shape must match what normalizeTrade() in App.jsx expects
    const trades = tradeRows.map(t => ({
      ticker:            t.ticker,
      type:              t.type,
      subtype:           t.subtype,
      strike:            t.strike,
      contracts:         t.contracts,
      open_date:         t.open_date,
      close_date:        t.close_date,
      expiry_date:       t.expiry_date,
      days_held:         t.days_held,
      premium_collected: t.premium_collected,
      kept_pct:          t.kept_pct,
      capital_fronted:   t.capital_fronted,
      description:       t.description,
      source:            t.source,
      notes:             t.notes,
    }));

    const positions = {
      last_updated: TODAY,
      ...reshapePositions(positionRows),
    };

    // Build account object — monthly_targets hardcoded (not yet in DB)
    const account = snapshot ? {
      last_updated:          snapshot.snapshot_date,
      account_value:         snapshot.account_value,
      cost_basis:            snapshot.cost_basis,
      free_cash_est:         snapshot.free_cash_est,
      free_cash_pct_est:     snapshot.free_cash_pct_est,
      vix_current:           snapshot.vix_current   ?? null,
      vix_band:              snapshot.vix_band       ?? null,
      month_to_date_premium: snapshot.month_to_date_premium,
      year:                  snapshot.current_year,
      current_month:         snapshot.current_month,
      monthly_targets:       { baseline: 15000, stretch: 25000 },
      notes:                 "",
    } : null;

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.setHeader("Content-Type", "application/json");
    res.status(200).json({ ok: true, trades, positions, account });
  } catch (err) {
    console.error("[api/data] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}
