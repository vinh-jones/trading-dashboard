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

// Rolling-window accumulation (uw-snapshot writes whale_put_sells each run).
// UW's flow-alerts endpoint is a short recent-activity window, so a plain
// overwrite makes prints vanish minutes after they cross. Instead we merge each
// snapshot's fresh prints into the stored list, dedupe, stamp first-seen, and
// prune to a rolling window — so a ticker's institutional put-selling persists
// for ~2 weeks rather than one 15-min snapshot.
export const WHALE_WINDOW_DAYS = 14;

// Stable per-print key for dedupe across snapshots. Built from the fields a
// print already carries (no UW id needed): a $50k+ print at a given strike /
// expiry with a specific size + underlying is effectively unique; genuinely
// identical prints collapsing to one is an acceptable rare undercount.
export function whalePrintKey(p) {
  return [p?.ticker, p?.strike, p?.expiry, p?.premium, p?.size ?? "", p?.underlying ?? ""].join("|");
}

export function mergeWhalePutSells(prev, fresh, { nowMs = Date.now(), windowDays = WHALE_WINDOW_DAYS } = {}) {
  const cutoff = nowMs - windowDays * 86400000;
  const nowIso = new Date(nowMs).toISOString();
  const byKey = new Map();

  // Carry prior prints, preserving their first-seen stamp (back-fill one on the
  // transition run for any that predate stamping).
  for (const p of Array.isArray(prev) ? prev : []) {
    byKey.set(whalePrintKey(p), p?.seen_at ? p : { ...p, seen_at: nowIso });
  }
  // Add fresh prints only if unseen — stamp first-seen now.
  for (const p of Array.isArray(fresh) ? fresh : []) {
    const k = whalePrintKey(p);
    if (!byKey.has(k)) byKey.set(k, { ...p, seen_at: nowIso });
  }

  return [...byKey.values()]
    .filter((p) => {
      const t = Date.parse(p.seen_at ?? "");
      return Number.isFinite(t) ? t >= cutoff : true;
    })
    .sort((a, b) => (Number(b.premium) || 0) - (Number(a.premium) || 0));
}

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
    // Candidate = STRONG entry setup AND repeat institutional put-selling (≥2
    // prints in the window). Per the flow-split decision, candidacy keys off the
    // PUT-SELL TAPE itself — the whale prints you're already looking at — NOT the
    // alert-subset flow scalar. Those measure different things (near-money
    // hedging vs far-OTM put-selling conviction), and gating ★ on the alert
    // subset was suppressing real put-sell setups. The repeat-print requirement
    // (≥2) is the "not a one-off" confirmation; the displayed Flow column lets
    // you still eyeball alert-subset sentiment yourself. A ★ only confirms a
    // setup lines up — it is never a buy signal, and the full OTU checklist still
    // sits above it.
    const isCandidate = score?.label === "Strong" && g.trade_count >= 2;
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
      score_num:      score?.score ?? null,
      iv_rank:        score?.ivRank ?? null,
      is_candidate:   isCandidate,
      trades:         g.trades,
    });
  }
  // Candidates first, then by total put-sell premium.
  return out.sort((a, b) =>
    (Number(b.is_candidate) - Number(a.is_candidate)) || (b.total_premium - a.total_premium));
}
