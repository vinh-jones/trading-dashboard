// Whale CSP flow (Consumer 5) — institutions selling puts, aggregated for CSP
// idea generation. Two layers:
//   - aggregateWhalePutSells: the flat, filtered list of individual put-sells.
//   - summarizeWhaleFlowByTicker: one row per ticker (total premium, trade
//     count, dominant strike, DTE range, flow sentiment), optionally joined to
//     the Radar entry score + IV rank → a ranked "good setup AND whales selling
//     puts" CSP shortlist.
//
// OTM% convention: (underlying − strike) / underlying. Positive = strike below
// spot (out-of-the-money — the normal CSP sell zone). The default filters keep
// only OTM puts in a 7–65 DTE window — the trades shaped like the ones you sell.

export const WHALE_FLOW_DEFAULTS = { minPremium: 50000, minDte: 7, maxDte: 65, otmOnly: true };

function dteFrom(expiryIso, todayIso) {
  if (!expiryIso) return null;
  const today = todayIso ? Date.parse(`${todayIso}T00:00:00Z`) : Date.now();
  return Math.round((Date.parse(`${expiryIso}T00:00:00Z`) - today) / 86400000);
}

export function aggregateWhalePutSells(uwSignalsList, opts = {}) {
  const { heldTickers, minPremium = 50000, minDte = null, maxDte = null, otmOnly = false, today } = opts;
  const held = heldTickers instanceof Set ? heldTickers : new Set(heldTickers ?? []);
  const rows = [];

  for (const sig of uwSignalsList ?? []) {
    const list = Array.isArray(sig?.whale_put_sells) ? sig.whale_put_sells : [];
    for (const w of list) {
      const premium = Number(w?.premium) || 0;
      if (premium < minPremium) continue;

      const strike     = Number(w?.strike);
      const underlying = w?.underlying != null ? Number(w.underlying) : null;
      const otmPct = (underlying && underlying > 0 && Number.isFinite(strike))
        ? ((underlying - strike) / underlying) * 100
        : null;
      if (otmOnly && !(otmPct > 0)) continue;

      const dte = dteFrom(w?.expiry, today);
      if (minDte != null && (dte == null || dte < minDte)) continue;
      if (maxDte != null && (dte == null || dte > maxDte)) continue;

      const ticker = w?.ticker ?? sig?.ticker;
      rows.push({
        ticker,
        strike:    Number.isFinite(strike) ? strike : null,
        expiry:    w?.expiry ?? null,
        premium,
        dte,
        otm_pct:   otmPct,
        has_sweep: !!w?.has_sweep,
        underlying,
        held:      held.has(ticker),
      });
    }
  }
  return rows.sort((a, b) => b.premium - a.premium);
}

export function summarizeWhaleFlowByTicker(uwSignalsList, opts = {}) {
  const { scoreByTicker } = opts;
  const flat = aggregateWhalePutSells(uwSignalsList, opts);

  const flowByTicker  = new Map((uwSignalsList ?? []).map((s) => [s.ticker, s.flow_sentiment]));
  const gammaByTicker = new Map((uwSignalsList ?? []).map((s) => [s.ticker, s.gamma_env]));
  const lookupScore = (t) =>
    typeof scoreByTicker?.get === "function" ? scoreByTicker.get(t) : scoreByTicker?.[t];

  const byTicker = new Map();
  for (const r of flat) {
    let g = byTicker.get(r.ticker);
    if (!g) {
      g = { ticker: r.ticker, total_premium: 0, trade_count: 0, byStrike: new Map(),
            dte_min: null, dte_max: null, any_sweep: false, held: r.held, trades: [] };
      byTicker.set(r.ticker, g);
    }
    g.total_premium += r.premium;
    g.trade_count   += 1;
    g.any_sweep      = g.any_sweep || r.has_sweep;
    g.byStrike.set(r.strike, (g.byStrike.get(r.strike) || 0) + r.premium);
    if (r.dte != null) {
      g.dte_min = g.dte_min == null ? r.dte : Math.min(g.dte_min, r.dte);
      g.dte_max = g.dte_max == null ? r.dte : Math.max(g.dte_max, r.dte);
    }
    g.trades.push(r);
  }

  const out = [];
  for (const g of byTicker.values()) {
    let topStrike = null, topPrem = -1;
    for (const [k, v] of g.byStrike) if (v > topPrem) { topPrem = v; topStrike = k; }
    const topTrade = g.trades.find((t) => t.strike === topStrike);
    const score = lookupScore(g.ticker) ?? null;
    const flow  = flowByTicker.get(g.ticker) ?? null;
    // Candidate = STRONG entry setup AND bullish institutional flow AND repeat
    // activity (≥2 prints, not a one-off). Strong-only + repeat is the Ryan-first
    // gate from the finance review: a ★ confirms a setup lines up — it is never a
    // buy signal, and the full OTU checklist still sits above it.
    const isCandidate = score?.label === "Strong" && flow != null && flow > 0.2 && g.trade_count >= 2;
    out.push({
      ticker:         g.ticker,
      total_premium:  g.total_premium,
      trade_count:    g.trade_count,
      top_strike:     topStrike,
      top_strike_otm: topTrade?.otm_pct ?? null,
      dte_min:        g.dte_min,
      dte_max:        g.dte_max,
      any_sweep:      g.any_sweep,
      held:           g.held,
      gamma_env:      gammaByTicker.get(g.ticker) ?? null,
      flow_sentiment: flow,
      score_label:    score?.label ?? null,
      iv_rank:        score?.ivRank ?? null,
      is_candidate:   isCandidate,
      trades:         g.trades,
    });
  }
  // Candidates first, then by total put-sell premium.
  return out.sort((a, b) =>
    (Number(b.is_candidate) - Number(a.is_candidate)) || (b.total_premium - a.total_premium));
}
