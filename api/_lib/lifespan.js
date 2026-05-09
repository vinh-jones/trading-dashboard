/**
 * api/_lib/lifespan.js
 *
 * Shared lifespan helpers used by:
 *   - api/position-lifespan.js
 *   - api/ticker-detail.js
 *   - api/eod-snapshot.js
 *
 * Exports: DATA_QUALITY_THRESHOLD, detectLifespans, buildLifespan,
 *          computeCspBaseline, lifespanSummary, computeDecisionFraming,
 *          and decision-framing helpers (classifyDrawdown, classifyBreakeven,
 *          getRecentCcStrike, addCalendarDays, subtractCalendarDays,
 *          humanizeDuration, computeTrailingCcRate)
 *
 * Private (not exported): tradeSortPriority, isRedundantSharesSold,
 *   computeBlendedBasis, computeVerdict, round2, round4, round6, daysBetween,
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

// Sort priority for same-day events: CC bookkeeping first, share-removal last.
// Ensures coordinated_exit CC Close is in cc_history before Shares Sold runs,
// and CC Assigned ends the lifespan before any redundant Shares Sold is seen.
function tradeSortPriority(trade) {
  if (trade.type === "CC" && (trade.subtype === "Close" || trade.subtype === "Roll Loss")) return 1;
  if (trade.type === "CC" && trade.subtype === "Assigned")  return 2;
  if (trade.type === "CSP" && trade.subtype === "Assigned") return 3;
  if (trade.type === "Shares") return 4;
  return 5;
}

// Returns true if a Shares Sold trade is a bookkeeping duplicate of a same-day
// CC Assigned event (the user logs both for tracking; only the CC Assigned matters).
function isRedundantSharesSold(trade, closedLifespans, currentLifespan) {
  const sameDay = (cc) =>
    cc.type === "CC" &&
    cc.subtype === "Assigned" &&
    cc.close_date === trade.close_date &&
    (cc.contracts ?? 1) * 100 === (trade.contracts ?? 0);

  // Partial disposal: CC Assigned didn't end the lifespan, current is still open
  if (currentLifespan && currentLifespan.cc_history.some(sameDay)) return true;

  // Full disposal: CC Assigned just ended the lifespan, check last closed
  const last = closedLifespans[closedLifespans.length - 1];
  if (last && last.ticker === trade.ticker && last.cc_history.some(sameDay)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Lifespan detection — running share count
// ---------------------------------------------------------------------------

export function detectLifespans(ticker, allTickerTrades) {
  // Pre-2026 bookkeeping was unreliable; treat anything before
  // DATA_QUALITY_THRESHOLD as if it didn't happen for share-cycle math.
  // Trades themselves remain visible in the Trade Timeline / All-Time Stats —
  // this filter only governs lifespan detection.
  const relevant = allTickerTrades.filter(
    (t) =>
      t.close_date &&
      t.close_date >= DATA_QUALITY_THRESHOLD &&
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

  const {
    avg_return_per_capital_day,
    sample_size,
    assignment_count,
    assignment_rate,
    avg_realized_loss_per_assignment,
  } = cspBaseline;
  // Annualized gross-income rate as a percent (×365 ×100). Diagnostic only;
  // never feeds back into the rate-based math above.
  const annualizedIncomeRatePct = round2(avg_return_per_capital_day * 365 * 100);
  const hasSpotAtEachAssignment = assignment_events.every((e) => e.spot_at_assignment != null);
  const assignmentCount = assignment_events.length;
  let cutAndRedeploy;

  if (!hasSpotAtEachAssignment) {
    cutAndRedeploy = {
      requires_spot_at_each_assignment:   true,
      assignment_count:                   assignmentCount,
      total_capital_to_redeploy:          null,
      total_realized_losses:              null,
      avg_csp_return_per_capital_day:     avg_return_per_capital_day,
      sample_size_csps_used:              sample_size,
      estimated_csp_pnl_over_lifespan:    null,
      net_outcome_if_cut_and_redeploy:    null,
      vs_actual_pnl:                      null,
      verdict: computeVerdict(lifespanStatus, null, false),
      annualized_income_rate_pct:         annualizedIncomeRatePct,
      assignment_count_in_baseline:       assignment_count,
      assignment_rate_in_baseline:        assignment_rate,
      avg_realized_loss_in_baseline:      avg_realized_loss_per_assignment,
      assignment_breakdown:               [],
    };
  } else {
    // Multi-assignment cut-and-redeploy (interpretation B): the cut alternative
    // takes assignment on every CSP that the wheel did, but cuts at each spot
    // instead of holding. Each cut frees a pool that redeploys at the baseline
    // rate for the remaining lifespan window from that assignment date.
    //
    // For single-assignment lifespans this reduces exactly to the prior formula.
    //
    // Known limitation: when freed capital from an earlier cut is partially
    // absorbed as collateral for a subsequent CSP (whose premium is already
    // counted in cspPremiumTotal), the freed × rate × inter-assignment-days
    // term double-counts that subsequent CSP's contribution by a bounded amount.
    // Tolerable; the baseline rate is itself an average estimate.
    const breakdown = assignment_events.map((e) => {
      const capitalFreed   = round2(e.spot_at_assignment * e.shares_added);
      const realizedLoss   = round2(e.capital_added - capitalFreed);
      const daysRemaining  = daysBetween(e.date, effectiveEnd);
      const estCspPnl      = avg_return_per_capital_day > 0 && daysRemaining > 0
        ? round2(capitalFreed * avg_return_per_capital_day * daysRemaining)
        : 0;
      return {
        date:           e.date,
        capital_added:  e.capital_added,
        capital_freed:  capitalFreed,
        realized_loss:  realizedLoss,
        days_remaining: daysRemaining,
        est_csp_pnl:    estCspPnl,
      };
    });

    const totalCapitalToRedeploy = round2(breakdown.reduce((s, b) => s + b.capital_freed, 0));
    const totalRealizedLosses    = round2(breakdown.reduce((s, b) => s + b.realized_loss, 0));
    const estCspPnlTotal         = round2(breakdown.reduce((s, b) => s + b.est_csp_pnl, 0));

    // Apples-to-apples with total_lifespan_pnl: both sides include cspPremiumTotal
    // (those premiums were collected in both scenarios before any cut decision).
    const netOutcome = round2(cspPremiumTotal - totalRealizedLosses + estCspPnlTotal);
    const vsActual   = totalLifespanPnl !== null ? round2(totalLifespanPnl - netOutcome) : null;

    cutAndRedeploy = {
      requires_spot_at_each_assignment:   true,
      assignment_count:                   assignmentCount,
      total_capital_to_redeploy:          totalCapitalToRedeploy,
      total_realized_losses:              totalRealizedLosses,
      avg_csp_return_per_capital_day:     avg_return_per_capital_day,
      sample_size_csps_used:              sample_size,
      estimated_csp_pnl_over_lifespan:    estCspPnlTotal,
      net_outcome_if_cut_and_redeploy:    netOutcome,
      vs_actual_pnl:                      vsActual,
      verdict: computeVerdict(lifespanStatus, vsActual, true),
      annualized_income_rate_pct:         annualizedIncomeRatePct,
      assignment_count_in_baseline:       assignment_count,
      assignment_rate_in_baseline:        assignment_rate,
      avg_realized_loss_in_baseline:      avg_realized_loss_per_assignment,
      assignment_breakdown:               breakdown,
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
      has_spot_at_each_assignment: hasSpotAtEachAssignment,
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

// Capital-day-weighted gross premium rate across all CSP holding periods
// (Close, Roll Loss, Assigned). Each CSP contributes premium / cap-days
// regardless of subtype — the realized loss on assignment is a discrete
// post-CSP event, not a flow that belongs in a per-cap-day rate.
//
// FRAMING LIMITATION the consuming code must respect: this rate models
// gross income only. The cut-and-redeploy benchmark that uses it
// (buildLifespan.estCspPnl) implicitly assumes redeployed capital faces
// zero modeled future-assignment risk. We deduct the deterministic
// realized loss for the lifespan being benchmarked at the consuming
// layer, but we do not statistically model losses on hypothetical
// redeployment-period CSPs. Verdicts should be read with that caveat.
//
// Diagnostic fields (assignment_count, assignment_rate,
// avg_realized_loss_per_assignment) describe the SAME sample but never feed
// back into avg_return_per_capital_day. They surface the assignment risk
// that the rate intentionally excludes, so a caller can present both
// signals side by side without recombining them.
export function computeCspBaseline(cspTrades) {
  let totalPremium = 0;
  let totalCapDays = 0;
  let included = 0;

  let assignmentCount = 0;
  let realizedLossSum = 0;
  let realizedLossCount = 0;

  for (const t of cspTrades) {
    const premium = parseFloat(t.premium_collected) || 0;
    const capital = parseFloat(t.capital_fronted)   || 0;
    const days    = parseFloat(t.days_held)         || 0;
    if (capital <= 0 || days <= 0) continue;

    totalPremium += premium;
    totalCapDays += capital * days;
    included++;

    if (t.subtype === "Assigned") {
      assignmentCount++;
      const strike    = parseFloat(t.strike);
      const spot      = parseFloat(t.spot_at_assignment);
      const contracts = parseFloat(t.contracts);
      if (
        Number.isFinite(strike) &&
        Number.isFinite(spot) &&
        Number.isFinite(contracts) &&
        t.spot_at_assignment != null
      ) {
        // Loss expressed as a positive dollar amount: how far below strike
        // the spot was at assignment, scaled to share count.
        realizedLossSum += (strike - spot) * contracts * 100;
        realizedLossCount++;
      }
    }
  }

  const avg = totalCapDays > 0 ? totalPremium / totalCapDays : 0;
  const assignmentRate = included > 0 ? assignmentCount / included : 0;
  const avgRealizedLossPerAssignment =
    realizedLossCount > 0 ? realizedLossSum / realizedLossCount : 0;

  return {
    avg_return_per_capital_day: avg,
    sample_size: included,
    assignment_count: assignmentCount,
    assignment_rate: assignmentRate,
    avg_realized_loss_per_assignment: round2(avgRealizedLossPerAssignment),
  };
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
function round4(n) { return +n.toFixed(4); }
function round6(n) { return +n.toFixed(6); }

// ---------------------------------------------------------------------------
// Decision-framing helpers
// ---------------------------------------------------------------------------

export function classifyDrawdown(pct) {
  if (pct >= -0.15) return "shallow";
  if (pct >= -0.30) return "moderate";
  if (pct >= -0.45) return "deep";
  return "severe";
}

export function classifyBreakeven(days) {
  if (days < 90)  return "quick_recovery";
  if (days < 270) return "decision_zone";
  if (days < 540) return "long_horizon";
  return "effectively_stuck";
}

// Most recent CC strike from cc_history (by close_date). Returns null when
// no CCs have closed yet for this lifespan. Does not consider currently-open
// CCs not yet in cc_history.
export function getRecentCcStrike(ccHistory) {
  if (!ccHistory || ccHistory.length === 0) return null;
  const sorted = [...ccHistory].sort(
    (a, b) => (b.close_date ?? "").localeCompare(a.close_date ?? "")
  );
  return sorted[0]?.strike ?? null;
}

// Calendar-day arithmetic on YYYY-MM-DD strings (no weekend skipping).
export function addCalendarDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function subtractCalendarDays(dateStr, days) {
  return addCalendarDays(dateStr, -days);
}

// Human-readable duration (≤ ~30 chars).
//   < 14 days     -> "~N days"
//   < 60 days     -> "~N weeks" (rounded to nearest week)
//   < 365 days    -> "~N.5 months" (rounded to nearest 0.5 month, 30.44 days/month)
//   >= 365 days   -> "~N.5 years" (rounded to nearest 0.5 year, 365.25 days/year)
export function humanizeDuration(days) {
  if (days < 14)  return `~${days} days`;
  if (days < 60)  return `~${Math.round(days / 7)} weeks`;
  if (days < 365) {
    const months = Math.round((days / 30.44) * 2) / 2;
    return `~${months} months`;
  }
  const years = Math.round((days / 365.25) * 2) / 2;
  return `~${years} years`;
}

// Trailing-window CC rate. Returns null if no CCs in the window (caller falls
// back to lifetime rate).
export function computeTrailingCcRate(ccHistory, today, days = 60) {
  const cutoff = subtractCalendarDays(today, days);
  const recent = (ccHistory ?? []).filter((cc) => (cc.close_date ?? "") >= cutoff);
  if (recent.length === 0) return null;
  const recentPnl  = recent.reduce((s, cc) => s + (parseFloat(cc.premium_collected) || 0), 0);
  const recentDays = recent.reduce((s, cc) => s + (parseFloat(cc.days_held) || 0), 0);
  return recentDays > 0 ? recentPnl / recentDays : 0;
}

// ---------------------------------------------------------------------------
// Decision framing for active assigned positions
// ---------------------------------------------------------------------------

// Computes a wheel-vs-cut-and-redeploy framing for an active assigned-share
// lifespan. Returns null when not applicable (closed, currentSpot >= cb, no
// shares held, missing inputs).
//
// See spec: docs/superpowers/specs/2026-05-09-decision-framing-active-positions-design.md
export function computeDecisionFraming({ lifespan, currentSpot, baselineRate, ticker, today }) {
  // Guards
  if (!lifespan || lifespan.lifespan_status !== "active") return null;
  if (!Array.isArray(lifespan.assignment_events) || lifespan.assignment_events.length === 0) return null;
  if (currentSpot == null || !Number.isFinite(currentSpot)) return null;

  const cb = parseFloat(lifespan.blended_cost_basis) || 0;
  if (cb <= 0)            return null;
  if (currentSpot >= cb)  return null;

  // currentShares = peak − sum(partial_dispositions.shares)
  const peak = parseFloat(lifespan.total_shares_at_peak) || 0;
  const disposedShares = (lifespan.partial_dispositions ?? []).reduce(
    (s, d) => s + (parseFloat(d.shares) || 0), 0
  );
  const currentShares = peak - disposedShares;
  if (currentShares <= 0) return null;

  const m = lifespan.lifespan_metrics ?? {};
  const cspPremium = parseFloat(m.csp_premium_collected) || 0;
  const ccPremium  = parseFloat(m.cc_premium_total)      || 0;
  const daysHeld   = parseFloat(m.days_active)           || 0;

  const partialDisposalPnl = (lifespan.partial_dispositions ?? []).reduce(
    (s, d) => s + (parseFloat(d.disposal_pnl) || 0), 0
  );

  const cumulativeWheelPnl     = round2(cspPremium + ccPremium + partialDisposalPnl);
  const realizedLoss           = round2((cb - currentSpot) * currentShares);
  const freedCapital           = round2(currentSpot * currentShares);
  const cutAlternativeStateNow = round2(cspPremium + partialDisposalPnl - realizedLoss);
  const gap                    = round2(cumulativeWheelPnl - cutAlternativeStateNow);

  const trailingCcRate = computeTrailingCcRate(lifespan.cc_history, today, 60);
  const usingTrailing  = trailingCcRate !== null;
  const lifetimeCcRate = daysHeld > 0 ? ccPremium / daysHeld : 0;
  const wheelDailyRate = usingTrailing ? trailingCcRate : lifetimeCcRate;

  const cutDailyRate      = freedCapital * (parseFloat(baselineRate) || 0);
  const dailyDifferential = cutDailyRate - wheelDailyRate;

  const drawdownPct  = (currentSpot - cb) / cb;
  const drawdownZone = classifyDrawdown(drawdownPct);

  const detailed_breakdown = {
    cumulative_wheel_pnl:        cumulativeWheelPnl,
    csp_premium_collected:       round2(cspPremium),
    cc_premium_total:            round2(ccPremium),
    partial_disposal_pnl:        round2(partialDisposalPnl),
    cc_count_winning:            m.cc_count_winning ?? null,
    cc_count_losing:             m.cc_count_losing  ?? null,
    trailing_60day_cc_rate:      trailingCcRate != null ? round4(trailingCcRate) : null,
    lifetime_cc_rate:            round4(lifetimeCcRate),
    using_trailing_rate:         usingTrailing,
    recent_cc_strike:            getRecentCcStrike(lifespan.cc_history),
    current_shares:              currentShares,
    realized_loss_if_cut_today:  realizedLoss,
    freed_capital_if_cut:        freedCapital,
    cut_alternative_state:       cutAlternativeStateNow,
    gap:                         gap,
    wheel_daily_rate:            round4(wheelDailyRate),
    cut_daily_rate:              round4(cutDailyRate),
    daily_differential:          round4(dailyDifferential),
  };

  if (dailyDifferential <= 0) {
    return {
      drawdown_pct:       round4(drawdownPct),
      drawdown_zone:      drawdownZone,
      days_to_breakeven:  null,
      breakeven_zone:     "wheel_ahead_perpetually",
      recovery_date:      null,
      framing_question:   "Wheel currently outperforming cut alternative; no breakeven date.",
      framing_duration:   null,
      detailed_breakdown,
    };
  }

  const daysToBreakeven = Math.ceil(gap / dailyDifferential);
  const recoveryDate    = addCalendarDays(today, daysToBreakeven);
  const breakevenZone   = classifyBreakeven(daysToBreakeven);

  return {
    drawdown_pct:       round4(drawdownPct),
    drawdown_zone:      drawdownZone,
    days_to_breakeven:  daysToBreakeven,
    breakeven_zone:     breakevenZone,
    recovery_date:      recoveryDate,
    framing_question:   `Do you think ${ticker} reaches $${cb.toFixed(2)} (cost basis) by ${recoveryDate}?`,
    framing_duration:   humanizeDuration(daysToBreakeven),
    detailed_breakdown,
  };
}
