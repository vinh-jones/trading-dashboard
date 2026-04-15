/**
 * api/_lib/reshapePositions.js
 *
 * Converts a flat array of position rows from Supabase back into the nested
 * shape that OpenPositionsTab, allocation chart, pipeline calculator, and
 * the Focus Engine expect:
 *   { assigned_shares: [...], open_csps: [...], open_leaps: [...] }
 *
 * Shared by /api/data (frontend load) and /api/snapshot (EOD alert evaluation)
 * so both read the same canonical shape.
 */

export function reshapePositions(rows) {
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
        entry_cost:        activeCC.entry_cost ?? null,
        delta:             activeCC.delta      ?? null,
        roi:               activeCC.roi        ?? null,
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
        expiry_date:     l.expiry_date    ?? null,
        contracts:       l.contracts      ?? null,
        strike:          l.strike         ?? null,
        entry_cost:      l.entry_cost     ?? null,
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
    entry_cost:        r.entry_cost ?? null,
    delta:             r.delta      ?? null,
    roi:               r.roi        ?? null,
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
      expiry_date:     l.expiry_date    ?? null,
      contracts:       l.contracts      ?? null,
      strike:          l.strike         ?? null,
      entry_cost:      l.entry_cost     ?? null,
      capital_fronted: l.capital_fronted,
      source:          l.source,
      notes:           l.notes,
    }));

  return { assigned_shares, open_csps, open_leaps };
}
