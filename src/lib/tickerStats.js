export function computeTickerStats({ trades = [], lifespans = [] }) {
  const closedTrades  = trades.filter((t) => t.close_date);
  const realizedPnl   = sumByKey(closedTrades, "premium_collected");

  const cspCcTrades   = closedTrades.filter((t) => t.type === "CSP" || t.type === "CC");
  const premiumCollected = sumByKey(cspCcTrades, "premium_collected");

  const trustedLifespans = lifespans.filter((l) => l.data_quality !== "suspect");
  const suspectLifespans = lifespans.filter((l) => l.data_quality === "suspect");

  const wheelsCompleted = trustedLifespans.filter(
    (l) => l.lifespan_status === "closed" && l.exit_event?.exit_type === "called_away"
  ).length;

  const wheelsSuspectExcluded = suspectLifespans.filter(
    (l) => l.lifespan_status === "closed" && l.exit_event?.exit_type === "called_away"
  ).length;

  const assignmentsTaken = trustedLifespans.reduce(
    (sum, l) => sum + (l.assignment_events?.length ?? 0),
    0
  );

  const timesCalledAway = wheelsCompleted;

  const closedCsps = closedTrades.filter((t) => t.type === "CSP" && t.subtype === "Close");
  const closedCcs  = closedTrades.filter((t) => t.type === "CC"  && t.subtype === "Close");
  const avgDaysCsp = avgByKey(closedCsps, "days_held");
  const avgDaysCc  = avgByKey(closedCcs,  "days_held");

  const keptCsps = closedCsps.filter((t) => t.kept_pct != null);
  const avgKeptPct = avgByKey(keptCsps, "kept_pct");

  const trustedTrades = closedTrades.filter((t) => t.data_quality !== "suspect");
  const bestTrade = trustedTrades.length === 0
    ? null
    : trustedTrades.reduce((a, b) => (b.premium_collected > a.premium_collected ? b : a));
  const worstTrade = trustedTrades.length === 0
    ? null
    : trustedTrades.reduce((a, b) => (b.premium_collected < a.premium_collected ? b : a));

  const usable = lifespans.filter(
    (l) => l.total_capital_committed > 0 && (l.lifespan_metrics?.days_active ?? 0) > 0
  );
  const totalCapitalDays = usable.reduce(
    (s, l) => s + l.total_capital_committed * l.lifespan_metrics.days_active,
    0
  );
  const totalDays = usable.reduce((s, l) => s + l.lifespan_metrics.days_active, 0);
  const avgCapital = totalDays > 0 ? totalCapitalDays / totalDays : 0;
  const capitalEfficiencyPct = avgCapital > 0 && totalDays > 0
    ? (realizedPnl / avgCapital) * (365 / totalDays) * 100
    : null;

  const belowCostCcAbsorption = lifespans.reduce((sum, l) => {
    const ccs = l.cc_history ?? [];
    return sum + ccs
      .filter((cc) => cc.relative_to_assignment === "below" && cc.premium_collected < 0)
      .reduce((s, cc) => s + cc.premium_collected, 0);
  }, 0);

  const includesSuspectData =
    suspectLifespans.length > 0 ||
    closedTrades.some((t) => t.data_quality === "suspect");

  return {
    realizedPnl: round2(realizedPnl),
    premiumCollected: round2(premiumCollected),
    capitalEfficiencyPct: capitalEfficiencyPct != null ? round2(capitalEfficiencyPct) : null,
    belowCostCcAbsorption: round2(belowCostCcAbsorption),
    wheelsCompleted,
    wheelsSuspectExcluded,
    assignmentsTaken,
    timesCalledAway,
    avgDaysCsp: avgDaysCsp != null ? round2(avgDaysCsp) : null,
    avgDaysCc:  avgDaysCc  != null ? round2(avgDaysCc)  : null,
    avgKeptPct: avgKeptPct != null ? round2(avgKeptPct) : null,
    bestTrade,
    worstTrade,
    includesSuspectData,
    tradeCount: closedTrades.length,
  };
}

function sumByKey(arr, key) {
  return arr.reduce((s, x) => s + (Number(x[key]) || 0), 0);
}

function avgByKey(arr, key) {
  if (arr.length === 0) return null;
  return sumByKey(arr, key) / arr.length;
}

function round2(n) {
  return n == null ? null : +n.toFixed(2);
}
