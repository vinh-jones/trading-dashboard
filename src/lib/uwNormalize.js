// Normalizers: raw Unusual Whales responses → the scalar signals the entry
// score consumes. Both outputs are scale-free, in [-1, 1], so no per-ticker
// calibration is needed. Pure + testable; the ingestion job calls these before
// upserting into `uw_signals`.

// Net dealer gamma as a scale-free ratio: (call + put) / (|call| + |put|).
//   > 0 → positive-gamma (dealers stabilize → chop, CSP-friendly)
//   < 0 → negative-gamma (dealers amplify → fast moves)
// Takes get_greek_exposure_by_ticker rows (array, ascending by date) and uses
// the latest. Returns null when unusable.
export function gammaEnvFromGreek(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const latest = rows[rows.length - 1];
  const call = Number(latest?.call_gamma);
  const put  = Number(latest?.put_gamma);
  if (!Number.isFinite(call) || !Number.isFinite(put)) return null;
  const gross = Math.abs(call) + Math.abs(put);
  if (gross === 0) return null;
  return (call + put) / gross;
}

// Flow sentiment from flow-alert rows. Each alert carries `type` (put/call) and
// bid/ask-side premium. For a CSP seller the bullish/bearish mapping is:
//   bullish = puts SOLD (bid-side) + calls BOUGHT (ask-side)
//   bearish = puts BOUGHT (ask-side) + calls SOLD (bid-side)
// Returns the net ratio (bullish − bearish) / total in [-1, 1], or null when
// there's no qualifying premium. Query flow_alerts per ticker WITHOUT a
// side/type filter so both directions are represented.
export function flowSentimentFromAlerts(alerts) {
  if (!Array.isArray(alerts) || alerts.length === 0) return null;
  let bullish = 0, bearish = 0;
  for (const a of alerts) {
    const bid = Number(a?.total_bid_side_prem) || 0;
    const ask = Number(a?.total_ask_side_prem) || 0;
    if (a?.type === "put")       { bullish += bid; bearish += ask; }
    else if (a?.type === "call") { bullish += ask; bearish += bid; }
  }
  const total = bullish + bearish;
  if (total === 0) return null;
  return (bullish - bearish) / total;
}

// Flow sentiment from the FULL options tape (get_flow_per_strike rows), the
// conviction reading the let-it-ride overlay and the entry-score nudge consume.
// Same bull/bear mapping as flowSentimentFromAlerts, but summed across every
// strike's directional premium instead of the unusual-activity alert subset —
// which is why the tape can read bullish while the alert subset reads bearish
// (near-money hedging dominates the alerts; far-OTM put-selling dominates the
// tape). Premium fields are strings. Returns (bullish − bearish) / total in
// [-1, 1], or null when there's no directional premium.
export function flowTapeFromTape(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let bullish = 0, bearish = 0;
  for (const r of rows) {
    bullish += (Number(r?.call_premium_ask_side) || 0) + (Number(r?.put_premium_bid_side) || 0);
    bearish += (Number(r?.call_premium_bid_side) || 0) + (Number(r?.put_premium_ask_side) || 0);
  }
  const total = bullish + bearish;
  if (total === 0) return null;
  return (bullish - bearish) / total;
}

// Radar IV + intraday price from a stock-screener (/screener/stocks) row, the
// columns the Tastytrade-via-OpenClaw /api/ingest-iv push used to write. UW
// answers Vercel directly, so one screener call refreshes the whole universe
// without the residential-IP detour. Screener values are strings. `iv` uses the
// 30-day IV (iv30d), matching the ~30d ATM IV the old pipeline sent, and falls
// back to `volatility` when iv30d is absent; `last` is the screener's `close`
// (latest price on the trading date). Returns null when the row carries no
// usable IV or price so a bad row never clobbers a good value.
export function ivQuoteFromScreenerRow(row) {
  if (!row) return null;
  const num = (v) => {
    if (v === null || v === undefined || v === "") return null; // Number("") === 0 would clobber
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const iv         = num(row.iv30d) ?? num(row.volatility);
  const iv_rank    = num(row.iv_rank);
  const last       = num(row.close);
  const prev_close = num(row.prev_close);
  if (iv == null && iv_rank == null && last == null && prev_close == null) return null;
  return { iv, iv_rank, last, prev_close };
}

// The Consumer-5 "whale CSP flow" list: institutions selling puts (Ryan's
// screen). Filters the same flow-alert pull to bid-side puts ≥ minPremium,
// keeps the fields the UI needs, sorted by premium desc.
export function whalePutSellsFromAlerts(alerts, minPremium = 50000) {
  if (!Array.isArray(alerts)) return [];
  return alerts
    .filter((a) => {
      if (a?.type !== "put") return false;
      const bid = Number(a?.total_bid_side_prem) || 0;
      const ask = Number(a?.total_ask_side_prem) || 0;
      return bid >= minPremium && bid >= ask; // predominantly sold at the bid
    })
    .map((a) => ({
      ticker:        a.ticker,
      strike:        Number(a.strike),
      expiry:        a.expiry,
      premium:       Number(a.total_bid_side_prem) || 0,
      size:          Number(a.total_size) || null,
      has_sweep:     !!a.has_sweep,
      alert_rule:    a.alert_rule ?? null,
      underlying:    Number(a.underlying_price) || null,
      next_earnings: a.next_earnings_date ?? null,
    }))
    .sort((x, y) => y.premium - x.premium);
}
