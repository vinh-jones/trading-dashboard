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

  const timesCalledAway = trustedLifespans.reduce((sum, l) => {
    const partials = (l.partial_dispositions ?? []).filter((d) => d.type === "called_away").length;
    const finalExit = l.exit_event?.exit_type === "called_away" ? 1 : 0;
    return sum + partials + finalExit;
  }, 0);

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

  // Capital efficiency — annualized realized P&L per dollar-day of capital.
  // Two denominators, both time-weighted (capital × days):
  //   • Assigned capital-days: capital committed once a CSP is assigned into
  //     shares (lifespan.total_capital_committed over days_active).
  //   • CSP collateral-days: cash a CSP secured while open — before it either
  //     expired/closed or converted to shares (capital_fronted over days_held).
  // A CSP's days_held ends at assignment and the lifespan's days_active begins
  // there, so summing the two stitches the timeline with no double-count.
  // The primary metric uses total secured capital (assigned + CSP collateral);
  // the secondary uses assigned-only capital. (CCs add no capital — their
  // collateral is the underlying shares, already counted as assigned capital.)
  const usableLifespans = lifespans.filter(
    (l) => l.total_capital_committed > 0 && (l.lifespan_metrics?.days_active ?? 0) > 0
  );
  const assignedCapitalDays = usableLifespans.reduce(
    (s, l) => s + l.total_capital_committed * l.lifespan_metrics.days_active,
    0
  );

  const cspCollateralTrades = closedTrades.filter(
    (t) => t.type === "CSP" && (Number(t.capital_fronted) || 0) > 0 && (Number(t.days_held) || 0) > 0
  );
  const cspCollateralDays = cspCollateralTrades.reduce(
    (s, t) => s + Number(t.capital_fronted) * Number(t.days_held),
    0
  );

  const securedCapitalDays = assignedCapitalDays + cspCollateralDays;
  const annualizeOnCapitalDays = (capitalDays) =>
    capitalDays > 0 ? (realizedPnl / capitalDays) * 365 * 100 : null;

  // Primary: return on total secured capital (matches the rest of the app's
  // collateral-based "deployed capital" vocabulary). Secondary: return on
  // capital that actually converted to shares.
  const capitalEfficiencyPct = annualizeOnCapitalDays(securedCapitalDays);
  const capitalEfficiencyAssignedPct = annualizeOnCapitalDays(assignedCapitalDays);

  const belowCostCcAbsorption = lifespans.reduce((sum, l) => {
    const ccs = l.cc_history ?? [];
    return sum + ccs
      .filter((cc) => cc.relative_to_assignment === "below" && cc.premium_collected < 0)
      .reduce((s, cc) => s + cc.premium_collected, 0);
  }, 0);

  const SUSPECT_BEFORE = "2026-01-01";
  const includesSuspectData =
    suspectLifespans.length > 0 ||
    closedTrades.some((t) => t.data_quality === "suspect" || (t.close_date && t.close_date < SUSPECT_BEFORE));

  return {
    realizedPnl: round2(realizedPnl),
    premiumCollected: round2(premiumCollected),
    capitalEfficiencyPct: capitalEfficiencyPct != null ? round2(capitalEfficiencyPct) : null,
    capitalEfficiencyAssignedPct: capitalEfficiencyAssignedPct != null ? round2(capitalEfficiencyAssignedPct) : null,
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
