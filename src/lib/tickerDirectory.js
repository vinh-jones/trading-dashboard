export function buildTickerDirectory({ trades = [], positions = {}, lifespans = [] }) {
  const tradesByTicker     = groupBy(trades, (t) => t.ticker);
  const lifespansByTicker  = groupBy(lifespans, (l) => l.ticker);
  const openTickers        = collectOpenTickers(positions);
  const tickers            = new Set([
    ...Object.keys(tradesByTicker),
    ...openTickers.keys(),
  ]);

  const rows = [];
  for (const ticker of tickers) {
    const tickerTrades    = tradesByTicker[ticker]    ?? [];
    const tickerLifespans = lifespansByTicker[ticker] ?? [];
    const open            = openTickers.get(ticker)   ?? null;

    const closedTrades = tickerTrades.filter((t) => t.close_date);
    const lastActivity = closedTrades.length === 0
      ? null
      : closedTrades.map((t) => t.close_date).sort().at(-1);

    const lifetimePnl = closedTrades.reduce(
      (s, t) => s + (Number(t.premium_collected) || 0), 0
    );

    const cycles         = tickerLifespans.filter((l) => l.data_quality !== "suspect").length;
    const cyclesSuspect  = tickerLifespans.filter((l) => l.data_quality === "suspect").length;

    const includesSuspect =
      tickerTrades.some((t) => t.data_quality === "suspect") ||
      tickerLifespans.some((l) => l.data_quality === "suspect");

    const capital = open ? capitalForTicker(open) : 0;
    const hasOpenPositions = !!open;

    rows.push({
      ticker,
      status: hasOpenPositions ? "active" : "idle",
      lastActivity,
      cycles,
      cyclesSuspect,
      lifetimePnl: round2(lifetimePnl),
      includesSuspect,
      capital: round2(capital),
      hasOpenPositions,
    });
  }

  return rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "");
  });
}

function groupBy(arr, keyFn) {
  const out = {};
  for (const item of arr) {
    const k = keyFn(item);
    if (!out[k]) out[k] = [];
    out[k].push(item);
  }
  return out;
}

function collectOpenTickers(positions) {
  const map = new Map();
  const add = (ticker, kind, item) => {
    if (!ticker) return;
    if (!map.has(ticker)) map.set(ticker, { csps: [], shares: [], leaps: [] });
    map.get(ticker)[kind].push(item);
  };
  for (const p of positions.open_csps      ?? []) add(p.ticker, "csps", p);
  for (const s of positions.assigned_shares ?? []) add(s.ticker, "shares", s);
  for (const l of positions.open_leaps     ?? []) add(l.ticker, "leaps", l);
  return map;
}

function capitalForTicker(open) {
  const cspCap   = (open.csps   ?? []).reduce((s, p) => s + (Number(p.capital_fronted) || 0), 0);
  const leapsCap = (open.leaps  ?? []).reduce((s, p) => s + (Number(p.capital_fronted) || 0), 0);
  const sharesCap = (open.shares ?? []).reduce((s, sh) => {
    if (sh.cost_basis_total != null) return s + Number(sh.cost_basis_total);
    return s + (sh.positions ?? []).reduce((ss, lot) => ss + (Number(lot.fronted) || 0), 0);
  }, 0);
  return cspCap + leapsCap + sharesCap;
}

function round2(n) {
  return n == null ? null : +n.toFixed(2);
}
