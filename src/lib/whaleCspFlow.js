// Whale CSP flow (Consumer 5) — aggregates the per-ticker whale put-sell lists
// stored in uw_signals into one ranked feed of institutions selling puts. This
// is Ryan's CSP idea-generation screen: "where are whales selling puts on my
// watchlist right now, and is the strike I'm eyeing being validated by size?"
//
// Each row is annotated against data we already have: how far out-of-the-money
// the sold put is vs the current underlying, and whether you already hold a
// position in that ticker.

export function aggregateWhalePutSells(uwSignalsList, { heldTickers, minPremium = 50000 } = {}) {
  const held = heldTickers instanceof Set ? heldTickers : new Set(heldTickers ?? []);
  const rows = [];

  for (const sig of uwSignalsList ?? []) {
    const list = Array.isArray(sig?.whale_put_sells) ? sig.whale_put_sells : [];
    for (const w of list) {
      const premium = Number(w?.premium) || 0;
      if (premium < minPremium) continue;

      const strike     = Number(w?.strike);
      const underlying = w?.underlying != null ? Number(w.underlying) : null;
      // For a sold put, strike below spot = out-of-the-money (positive %).
      const otmPct = (underlying && underlying > 0 && Number.isFinite(strike))
        ? ((underlying - strike) / underlying) * 100
        : null;

      const ticker = w?.ticker ?? sig?.ticker;
      rows.push({
        ticker,
        strike:     Number.isFinite(strike) ? strike : null,
        expiry:     w?.expiry ?? null,
        premium,
        size:       w?.size != null ? Number(w.size) : null,
        has_sweep:  !!w?.has_sweep,
        underlying,
        otm_pct:    otmPct,
        held:       held.has(ticker),
      });
    }
  }

  return rows.sort((a, b) => b.premium - a.premium);
}
