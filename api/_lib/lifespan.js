/**
 * api/_lib/lifespan.js
 *
 * Shared lifespan helpers used by:
 *   - api/position-lifespan.js
 *   - api/ticker-detail.js
 *
 * Exports: DATA_QUALITY_THRESHOLD, detectLifespans, buildLifespan,
 *          computeCspBaseline, lifespanSummary
 *
 * Private (not exported): tradeSortPriority, isRedundantSharesSold,
 *   computeBlendedBasis, computeVerdict, round2, round6, daysBetween,
 *   daysBetweenDates, clusterLifespanDecisions
 */

export const DATA_QUALITY_THRESHOLD = "2026-01-01";

// ---------------------------------------------------------------------------
// Summary shape (list modes)
// ---------------------------------------------------------------------------

export function lifespanSummary(l) {
  return {
    ticker: l.ticker,
    assignment_id: l.assignment_id,
    lifespan_status: l.lifespan_status,
    data_quality: l.data_quality,
    assignment_date: l.assignment_events[0]?.date ?? null,
    exit_date: l.exit_event?.date ?? null,
    days_active: l.lifespan_metrics.days_active,
    total_shares_at_peak: l.total_shares_at_peak,
    total_capital_committed: l.total_capital_committed,
    blended_cost_basis: l.blended_cost_basis,
    total_lifespan_pnl: l.lifespan_metrics.total_lifespan_pnl,
    return_pct_on_capital: l.lifespan_metrics.return_pct_on_capital,
    spaxx_verdict: l.benchmarks.spaxx_baseline.verdict,
    cut_and_redeploy_verdict: l.benchmarks.cut_and_redeploy_baseline.verdict,
  };
}

// ---------------------------------------------------------------------------
// Lifespan detection helpers (private)
// ---------------------------------------------------------------------------

function tradeSortPriority(trade) {
  if (trade.type === "CC" && (trade.subtype === "Close" || trade.subtype === "Roll Loss")) return 1;
  if (trade.type === "CC" && trade.subtype === "Assigned")  return 2;
  if (trade.type === "CSP" && trade.subtype === "Assigned") return 3;
  if (trade.type === "Shares") return 4;
  return 5;
}

function isRedundantSharesSold(trade, closedLifespans, currentLifespan) {
  const sameDay = (cc) =>
    cc.type === "CC" &&
    cc.subtype === "Assigned" &&
    cc.close_date === trade.close_date &&
    (cc.contracts ?? 1) * 100 === (trade.contracts ?? 0);

  if (currentLifespan && currentLifespan.cc_history.some(sameDay)) return true;

  const last = closedLifespans[closedLifespans.length - 1];
  if (last && last.ticker === trade.ticker && last.cc_history.some(sameDay)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Lifespan detection — running share count
// ---------------------------------------------------------------------------

export function detectLifespans(ticker, allTickerTrades) {
  const relevant = allTickerTrades.filter(
    (t) =>
      t.close_date &&
      ((t.type === "CSP" && t.subtype === "Assigned") ||
        (t.type === "CC" &&
          (t.subtype === "Close" ||
            t.subtype === "Roll Loss" ||
            t.subtype === "Assigned")) ||
        (t.type === "Shares" &&
          (t.subtype === "Sold" || t.subtype === "Exit")))
  );

  const sorted = [...relevant].sort((a, b) => {
    const d = (a.close_date ?? "").localeCompare(b.close_date ?? "");
    if (d !== 0) return d;
    const pd = tradeSortPriority(a) - tradeSortPriority(b);
    if (pd !== 0) return pd;
    return (a.open_date ?? "").localeCompare(b.open_date ?? "");
  });

  let runningShares = 0;
  let current = null;
  const lifespans = [];
  const orphanWarnings = [];

  for (const trade of sorted) {
    if (trade.type === "CSP" && trade.subtype === "Assigned") {
      const sharesAdded = (trade.contracts ?? 1) * 100;
      if (runningShares === 0) {
        current = {
          ticker,
          assignment_events: [],
          _cspTrades: [],
          cc_history: [],
          partial_dispositions: [],
          exit_event: null,
          _disposalTrade: null,
          _orphanWarnings: [],
        };
      }
      current._cspTrades.push(trade);
      current.assignment_events.push({
        date: trade.close_date,
        triggering_csp_id: trade.id,
        strike: parseFloat(trade.strike) || 0,
        csp_premium_collected: round2(parseFloat(trade.premium_collected) || 0),
        shares_added: sharesAdded,
        capital_added: round2(sharesAdded * (parseFloat(trade.strike) || 0)),
        spot_at_assignment:
          trade.spot_at_assignment != null
            ? parseFloat(trade.spot_at_assignment)
            : null,
      });
      runningShares += sharesAdded;

    } else if (
      trade.type === "CC" &&
      (trade.subtype === "Close" || trade.subtype === "Roll Loss")
    ) {
      if (current !== null) {
        current.cc_history.push(trade);
      } else {
        orphanWarnings.push(
          `CC ${trade.subtype} for ${ticker} on ${trade.close_date} (id: ${trade.id}) with no active lifespan`
        );
      }

    } else if (trade.type === "CC" && trade.subtype === "Assigned") {
      const sharesRemoved = (trade.contracts ?? 1) * 100;
      if (current !== null) {
        current.cc_history.push(trade);
        const basis = computeBlendedBasis(current.assignment_events);
        const disposalPnl = round2(
          (parseFloat(trade.strike) - basis) * sharesRemoved
        );
        runningShares -= sharesRemoved;
        if (runningShares === 0) {
          current.exit_event = {
            date: trade.close_date,
            exit_type: "called_away",
            exit_price: parseFloat(trade.strike) || null,
            shares_disposed: sharesRemoved,
            share_disposal_pnl: disposalPnl,
            triggering_decision_id: null,
          };
          current._disposalTrade = trade;
          lifespans.push(current);
          current = null;
        } else {
          current.partial_dispositions.push({
            date: trade.close_date,
            type: "called_away",
            shares: sharesRemoved,
            disposal_pnl: disposalPnl,
          });
        }
      }

    } else if (
      trade.type === "Shares" &&
      (trade.subtype === "Sold" || trade.subtype === "Exit")
    ) {
      if (isRedundantSharesSold(trade, lifespans, current)) continue;

      const sharesRemoved = trade.contracts ?? 0;
      const disposalPnl = round2(parseFloat(trade.premium_collected) || 0);
      if (current !== null) {
        const sameDayCc = current.cc_history.find(
          (cc) =>
            cc.close_date === trade.close_date &&
            (cc.subtype === "Close" || cc.subtype === "Roll Loss")
        );
        const exitType = sameDayCc ? "coordinated_exit" : "manual_sale";
        const basis = computeBlendedBasis(current.assignment_events);
        const exitPrice =
          sharesRemoved > 0
            ? round2(basis + disposalPnl / sharesRemoved)
            : null;
        runningShares -= sharesRemoved;
        if (runningShares === 0) {
          current.exit_event = {
            date: trade.close_date,
            exit_type: exitType,
            exit_price: exitPrice,
            shares_disposed: sharesRemoved,
            share_disposal_pnl: disposalPnl,
            triggering_decision_id: null,
          };
          current._disposalTrade = trade;
          lifespans.push(current);
          current = null;
        } else {
          current.partial_dispositions.push({
            date: trade.close_date,
            type: exitType,
            shares: sharesRemoved,
            disposal_pnl: disposalPnl,
          });
        }
      } else {
        orphanWarnings.push(
          `Shares ${trade.subtype} for ${ticker} on ${trade.close_date} (id: ${trade.id}) with no active lifespan`
        );
      }
    }
  }

  if (current !== null) lifespans.push(current);

  if (orphanWarnings.length > 0 && lifespans.length > 0) {
    lifespans[0]._orphanWarnings.push(...orphanWarnings);
  }

  return lifespans;
}

// ---------------------------------------------------------------------------
// Lifespan computation — metrics, benchmarks, decisions
// ---------------------------------------------------------------------------

export function buildLifespan(raw, cspBaseline, today) {
  const { ticker, assignment_events, cc_history, partial_dispositions, exit_event } = raw;

  const firstAssignment = assignment_events[0];
  const assignmentId    = firstAssignment?.date ?? null;
  const lifespanStatus  = exit_event ? "closed" : "active";
  const effectiveEnd    = exit_event ? exit_event.date : today;

  const basisRaw           = computeBlendedBasis(assignment_events);
  const blendedBasis        = round2(basisRaw);
  const totalSharesAtPeak   = assignment_events.reduce((s, e) => s + e.shares_added, 0);
  const totalCapital        = round2(assignment_events.reduce((s, e) => s + e.capital_added, 0));
  const cspPremiumTotal     = round2(assignment_events.reduce((s, e) => s + e.csp_premium_collected, 0));

  const ccPremiumTotal   = round2(cc_history.reduce((s, t) => s + (parseFloat(t.premium_collected) || 0), 0));
  const ccPremiumWinning = round2(cc_history.filter((t) => (parseFloat(t.premium_collected) || 0) > 0)
    .reduce((s, t) => s + (parseFloat(t.premium_collected) || 0), 0));
  const ccPremiumLosing  = round2(cc_history.filter((t) => (parseFloat(t.premium_collected) || 0) < 0)
    .reduce((s, t) => s + (parseFloat(t.premium_collected) || 0), 0));

  const shareDisposalPnl = lifespanStatus === "closed"
    ? round2([
        ...partial_dispositions.map((d) => d.disposal_pnl ?? 0),
        exit_event ? (exit_event.share_disposal_pnl ?? 0) : 0,
      ].reduce((s, v) => s + v, 0))
    : null;

  const totalLifespanPnl =
    lifespanStatus === "closed" && shareDisposalPnl !== null
      ? round2(cspPremiumTotal + ccPremiumTotal + shareDisposalPnl)
      : null;

  const daysActive    = daysBetween(assignmentId, effectiveEnd);
  const capitalDays   = round2(totalCapital * daysActive);
  const canRate       = daysActive >= 1 && totalCapital > 0 && totalLifespanPnl !== null;
  const returnPct     = canRate ? round6(totalLifespanPnl / totalCapital) : null;
  const annualPct     = canRate ? round6(returnPct * (365 / daysActive)) : null;
  const returnPerCapDay = canRate && capitalDays > 0
    ? +(totalLifespanPnl / capitalDays).toFixed(8)
    : null;

  const spaxxReturn   = round2(totalCapital * 0.04 * (daysActive / 365));
  const spaxxVsActual = totalLifespanPnl !== null ? round2(totalLifespanPnl - spaxxReturn) : null;

  const { avg_return_per_capital_day, sample_size } = cspBaseline;
  const hasSpotAtFirst = firstAssignment?.spot_at_assignment != null;
  let cutAndRedeploy;

  if (!hasSpotAtFirst) {
    cutAndRedeploy = {
      requires_spot_at_first_assignment:  true,
      sell_at_assignment_recovery:        null,
      realized_loss_at_assignment:        null,
      capital_to_redeploy:                null,
      avg_csp_return_per_capital_day:     avg_return_per_capital_day,
      sample_size_csps_used:              sample_size,
      estimated_csp_pnl_over_lifespan:    null,
      net_outcome_if_cut_and_redeploy:    null,
      vs_actual_pnl:                      null,
      verdict: computeVerdict(lifespanStatus, null, false),
    };
  } else {
    const fa             = firstAssignment;
    const sellRecovery   = round2(fa.spot_at_assignment * fa.shares_added);
    const realizedLoss   = round2(fa.capital_added - sellRecovery);
    const toRedeploy     = sellRecovery;
    const estCspPnl      = avg_return_per_capital_day > 0
      ? round2(toRedeploy * avg_return_per_capital_day * daysActive)
      : 0;
    const netOutcome     = round2(-realizedLoss + estCspPnl);
    const vsActual       = totalLifespanPnl !== null ? round2(totalLifespanPnl - netOutcome) : null;
    cutAndRedeploy = {
      requires_spot_at_first_assignment:  true,
      sell_at_assignment_recovery:        sellRecovery,
      realized_loss_at_assignment:        realizedLoss,
      capital_to_redeploy:                toRedeploy,
      avg_csp_return_per_capital_day:     avg_return_per_capital_day,
      sample_size_csps_used:              sample_size,
      estimated_csp_pnl_over_lifespan:    estCspPnl,
      net_outcome_if_cut_and_redeploy:    netOutcome,
      vs_actual_pnl:                      vsActual,
      verdict: computeVerdict(lifespanStatus, vsActual, true),
    };
  }

  const dataQuality = (assignmentId ?? "") >= DATA_QUALITY_THRESHOLD ? "trusted" : "suspect";

  const warnings = [...(raw._orphanWarnings ?? [])];
  if (daysActive < 1)
    warnings.push("days_active < 1: same-day assignment and exit; rate-based metrics are null");
  if (sample_size < 10)
    warnings.push(
      `CSP baseline uses only ${sample_size} sample${sample_size === 1 ? "" : "s"} (< 10); ` +
      "cut-and-redeploy estimate is low-confidence"
    );

  const ccHistoryFormatted = cc_history.map((t) => ({
    trade_id:              t.id,
    open_date:             t.open_date,
    close_date:            t.close_date,
    strike:                parseFloat(t.strike) || t.strike,
    contracts:             t.contracts,
    premium_collected:     round2(parseFloat(t.premium_collected) || 0),
    kept_pct:              t.kept_pct ?? null,
    days_held:             t.days_held,
    relative_to_assignment:
      parseFloat(t.strike) > basisRaw ? "above" :
      parseFloat(t.strike) === basisRaw ? "at" : "below",
    is_winning:            (parseFloat(t.premium_collected) || 0) > 0,
    journal_context_summary: null,
  }));

  const lifespanTrades = [
    ...(raw._cspTrades ?? []),
    ...cc_history,
    ...(raw._disposalTrade ? [raw._disposalTrade] : []),
  ];
  const lifespanDecisions = clusterLifespanDecisions(lifespanTrades, ticker);
  const tradeIds = lifespanTrades.map((t) => t.id).filter(Boolean);

  return {
    ticker,
    assignment_id:          assignmentId,
    lifespan_status:        lifespanStatus,
    data_quality:           dataQuality,

    assignment_events,
    blended_cost_basis:     blendedBasis,
    total_shares_at_peak:   totalSharesAtPeak,
    total_capital_committed: totalCapital,
    exit_event,
    partial_dispositions,

    lifespan_metrics: {
      days_active:            daysActive,
      capital_days:           capitalDays,
      csp_premium_collected:  cspPremiumTotal,
      cc_premium_total:       ccPremiumTotal,
      cc_premium_winning:     ccPremiumWinning,
      cc_premium_losing:      ccPremiumLosing,
      share_disposal_pnl:     shareDisposalPnl,
      total_lifespan_pnl:     totalLifespanPnl,
      cc_count_total:         cc_history.length,
      cc_count_winning:       cc_history.filter((t) => (parseFloat(t.premium_collected) || 0) > 0).length,
      cc_count_losing:        cc_history.filter((t) => (parseFloat(t.premium_collected) || 0) < 0).length,
      return_pct_on_capital:  returnPct,
      annualized_return_pct:  annualPct,
      return_per_capital_day: returnPerCapDay,
    },

    cc_history:         ccHistoryFormatted,
    lifespan_decisions: lifespanDecisions,

    benchmarks: {
      spaxx_baseline: {
        annual_rate:    0.04,
        total_return:   spaxxReturn,
        vs_actual_pnl:  spaxxVsActual,
        verdict:        computeVerdict(lifespanStatus, spaxxVsActual, true),
      },
      cut_and_redeploy_baseline: cutAndRedeploy,
    },

    computed_at: new Date().toISOString(),
    data_completeness: {
      has_spot_at_first_assignment: hasSpotAtFirst,
      has_all_ccs:                  true,
      has_disposal_event:           lifespanStatus === "closed",
      warnings,
    },

    _tradeIds: tradeIds,
  };
}

// ---------------------------------------------------------------------------
// Decision clustering (private — called by buildLifespan)
// ---------------------------------------------------------------------------

function clusterLifespanDecisions(trades, ticker) {
  const decisions = [];
  let counter = 0;
  const nextId   = () => `ld_${String(++counter).padStart(3, "0")}`;
  const assigned = new Set();

  const cspAssignedTrades = trades
    .filter((t) => t.type === "CSP" && t.subtype === "Assigned")
    .sort((a, b) => (a.close_date ?? "").localeCompare(b.close_date ?? ""));
  for (const t of cspAssignedTrades) {
    decisions.push({
      decision_id:   nextId(),
      decision_type: "assignment_taken",
      decision_date: t.close_date,
      summary:       `${ticker} CSP $${t.strike} ${t.expiry_date} assigned`,
      net_pnl:       round2(parseFloat(t.premium_collected) || 0),
    });
    assigned.add(t.id);
  }

  const ccTrades = trades.filter((t) => t.type === "CC");
  for (const t of ccTrades) {
    if (assigned.has(t.id)) continue;
    if (t.subtype !== "Close" && t.subtype !== "Roll Loss") continue;
    const newLeg = ccTrades.find(
      (u) =>
        !assigned.has(u.id) &&
        u.id !== t.id &&
        u.subtype !== "Assigned" &&
        daysBetweenDates(t.close_date, u.open_date) <= 3 &&
        (u.strike !== t.strike || u.expiry_date !== t.expiry_date)
    );
    if (newLeg) {
      const net = round2(
        (parseFloat(t.premium_collected) || 0) +
        (parseFloat(newLeg.premium_collected) || 0)
      );
      decisions.push({
        decision_id:   nextId(),
        decision_type: "cc_roll",
        decision_date: t.close_date,
        summary:
          `${ticker} CC rolled: $${t.strike} ${t.expiry_date} → ` +
          `$${newLeg.strike} ${newLeg.expiry_date} (${net >= 0 ? "+" : ""}$${Math.abs(net).toFixed(0)})`,
        net_pnl: net,
      });
      assigned.add(t.id);
      assigned.add(newLeg.id);
    }
  }

  for (const t of trades) {
    if (assigned.has(t.id) || t.type !== "CC" || t.subtype !== "Assigned") continue;
    decisions.push({
      decision_id:   nextId(),
      decision_type: "called_away",
      decision_date: t.close_date,
      summary:       `${ticker} CC $${t.strike} ${t.expiry_date} assigned — shares called away`,
      net_pnl:       round2(parseFloat(t.premium_collected) || 0),
    });
    assigned.add(t.id);
  }

  for (const t of trades) {
    if (assigned.has(t.id)) continue;
    if (t.type !== "Shares" || (t.subtype !== "Sold" && t.subtype !== "Exit")) continue;
    decisions.push({
      decision_id:   nextId(),
      decision_type: "shares_sold",
      decision_date: t.close_date,
      summary:       `${ticker} shares sold`,
      net_pnl:       round2(parseFloat(t.premium_collected) || 0),
    });
    assigned.add(t.id);
  }

  for (const t of trades) {
    if (assigned.has(t.id) || t.type !== "CC") continue;
    const pnl = round2(parseFloat(t.premium_collected) || 0);
    decisions.push({
      decision_id:   nextId(),
      decision_type: "cc_close",
      decision_date: t.close_date,
      summary:
        `${ticker} CC $${t.strike} ${t.expiry_date} closed ` +
        `(${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(0)})`,
      net_pnl: pnl,
    });
    assigned.add(t.id);
  }

  return decisions.sort((a, b) =>
    (a.decision_date ?? "").localeCompare(b.decision_date ?? "")
  );
}

// ---------------------------------------------------------------------------
// CSP performance baseline
// ---------------------------------------------------------------------------

export function computeCspBaseline(cspTrades) {
  const returns = cspTrades
    .map((t) => {
      const premium = parseFloat(t.premium_collected) || 0;
      const capital = parseFloat(t.capital_fronted) || 0;
      const days    = parseFloat(t.days_held) || 0;
      if (capital <= 0 || days <= 0) return null;
      return premium / (capital * days);
    })
    .filter((r) => r != null);

  const avg = returns.length > 0
    ? returns.reduce((s, r) => s + r, 0) / returns.length
    : 0;

  return { avg_return_per_capital_day: avg, sample_size: returns.length };
}

// ---------------------------------------------------------------------------
// Private utilities
// ---------------------------------------------------------------------------

function computeBlendedBasis(assignmentEvents) {
  const totalCapital = assignmentEvents.reduce((s, e) => s + e.capital_added, 0);
  const totalShares  = assignmentEvents.reduce((s, e) => s + e.shares_added, 0);
  return totalShares > 0 ? totalCapital / totalShares : 0;
}

function computeVerdict(lifespanStatus, vsActualPnl, hasRequiredData) {
  if (lifespanStatus === "active") return "active";
  if (!hasRequiredData || vsActualPnl === null) return "data_missing";
  if (vsActualPnl > 0) return "outperformed";
  if (vsActualPnl < 0) return "underperformed";
  return "even";
}

function daysBetween(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const from = new Date(fromDate + "T00:00:00Z");
  const to   = new Date(toDate   + "T00:00:00Z");
  return Math.round((to - from) / 86_400_000);
}

function daysBetweenDates(d1, d2) {
  if (!d1 || !d2) return Infinity;
  return (
    Math.abs(
      new Date(d2 + "T00:00:00Z").getTime() -
      new Date(d1 + "T00:00:00Z").getTime()
    ) / 86_400_000
  );
}

function round2(n) { return +n.toFixed(2); }
function round6(n) { return +n.toFixed(6); }
