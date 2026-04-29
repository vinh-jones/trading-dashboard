/**
 * api/position-lifespan.js — Vercel serverless function
 *
 * GET /api/position-lifespan?ticker={TICKER}&assignment_id={DATE}
 *
 * Returns the full economic picture of an assigned-share lifespan: from
 * CSP assignment through share disposal, with P&L components and
 * counterfactual benchmarks (SPAXX, cut-and-redeploy).
 *
 * With assignment_id (YYYY-MM-DD): returns single lifespan object.
 * Without assignment_id: returns list of all lifespans for the ticker.
 * No lifespans found: 404 with informative error.
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { ticker, assignment_id } = req.query;

  if (!ticker) {
    return res.status(400).json({ ok: false, error: "ticker is required" });
  }

  const tickerUpper = ticker.toUpperCase();
  const today = new Date().toISOString().slice(0, 10);

  try {
    const supabase = getSupabase();

    // Fetch all trades for this ticker + CSP baseline (last 60 closed CSPs) in parallel
    const [tickerTradesResult, cspBaselineResult] = await Promise.all([
      supabase
        .from("trades")
        .select("*")
        .eq("ticker", tickerUpper)
        .order("close_date", { ascending: true }),

      // CSP performance baseline: last 60 closed (non-assigned) CSPs
      supabase
        .from("trades")
        .select("id, premium_collected, capital_fronted, days_held, close_date")
        .eq("type", "CSP")
        .eq("subtype", "Close")
        .gt("days_held", 0)
        .gt("capital_fronted", 0)
        .order("close_date", { ascending: false })
        .limit(60),
    ]);

    if (tickerTradesResult.error)
      throw new Error(`trades: ${tickerTradesResult.error.message}`);
    if (cspBaselineResult.error)
      throw new Error(`csp_baseline: ${cspBaselineResult.error.message}`);

    const allTickerTrades = tickerTradesResult.data ?? [];
    const cspBaselineTrades = cspBaselineResult.data ?? [];

    // All assignment events for this ticker (CSP Assigned), most-recent-first
    const assignmentEvents = allTickerTrades
      .filter((t) => t.type === "CSP" && t.subtype === "Assigned")
      .sort((a, b) => (b.close_date ?? "").localeCompare(a.close_date ?? ""));

    if (assignmentEvents.length === 0) {
      return res.status(404).json({
        ok: false,
        error:
          `No assigned-share lifespans found for ticker ${tickerUpper}. ` +
          `Only CSP-to-assignment positions are tracked here; ` +
          `CSP-only or LEAPS positions are not included.`,
      });
    }

    const cspBaseline = computeCspBaseline(cspBaselineTrades);

    if (assignment_id) {
      // --- Single lifespan mode ---
      const triggeringCsp = assignmentEvents.find(
        (t) => t.close_date === assignment_id
      );
      if (!triggeringCsp) {
        return res.status(404).json({
          ok: false,
          error:
            `No assignment found for ${tickerUpper} on ${assignment_id}. ` +
            `Available assignment dates: ${assignmentEvents.map((t) => t.close_date).join(", ")}`,
        });
      }

      const lifespan = buildLifespan(
        triggeringCsp,
        allTickerTrades,
        assignmentEvents,
        cspBaseline,
        today
      );

      // Fetch journal entries linked to lifespan trades
      const tradeIds = lifespan._tradeIds;
      let linkedJournals = [];
      if (tradeIds.length > 0) {
        const journalResult = await supabase
          .from("journal_entries")
          .select("id, entry_date, entry_type, title, body, trade_id")
          .in("trade_id", tradeIds);
        if (!journalResult.error) linkedJournals = journalResult.data ?? [];
      }

      const result = finalizeLifespan(lifespan, linkedJournals);

      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json({ ok: true, ...result });
    } else {
      // --- List mode: all lifespans for ticker ---
      const lifespans = assignmentEvents.map((triggeringCsp) =>
        buildLifespan(
          triggeringCsp,
          allTickerTrades,
          assignmentEvents,
          cspBaseline,
          today
        )
      );

      const summaries = lifespans.map((l) => ({
        assignment_id: l.assignment_id,
        lifespan_status: l.lifespan_status,
        assignment_date: l.assignment_event.date,
        exit_date: l.exit_event?.date ?? null,
        days_active: l.lifespan_metrics.days_active,
        initial_capital: l.assignment_event.initial_capital,
        total_lifespan_pnl: l.lifespan_metrics.total_lifespan_pnl,
        return_pct_on_capital: l.lifespan_metrics.return_pct_on_capital,
        spaxx_verdict: l.benchmarks.spaxx_baseline.verdict,
        cut_and_redeploy_verdict: l.benchmarks.cut_and_redeploy_baseline.verdict,
      }));

      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json({
        ok: true,
        ticker: tickerUpper,
        lifespan_count: summaries.length,
        lifespans: summaries,
      });
    }
  } catch (err) {
    console.error("[api/position-lifespan] Error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Core lifespan builder
// ---------------------------------------------------------------------------

function buildLifespan(triggeringCsp, allTickerTrades, allAssignmentEvents, cspBaseline, today) {
  const assignmentDate   = triggeringCsp.close_date;
  const assignmentPrice  = parseFloat(triggeringCsp.strike) || 0;
  const shares           = (triggeringCsp.contracts ?? 1) * 100;
  const initialCapital   = round2(assignmentPrice * shares);
  const cspPremium       = parseFloat(triggeringCsp.premium_collected) || 0;
  const spotAtAssignment =
    triggeringCsp.spot_at_assignment != null
      ? parseFloat(triggeringCsp.spot_at_assignment)
      : null;

  // Later assignment events on the same ticker (for overlap warning)
  const laterAssignments = allAssignmentEvents
    .filter((t) => t.id !== triggeringCsp.id && t.close_date > assignmentDate)
    .sort((a, b) => a.close_date.localeCompare(b.close_date));
  const nextAssignmentDate = laterAssignments[0]?.close_date ?? null;

  // Share disposal: first eligible trade after assignment_date
  // - Shares Sold/Exit: manual sale or coordinated exit
  // - CC Assigned: shares called away
  const disposalTrade =
    allTickerTrades
      .filter(
        (t) =>
          t.close_date > assignmentDate &&
          t.id !== triggeringCsp.id &&
          ((t.type === "Shares" && (t.subtype === "Sold" || t.subtype === "Exit")) ||
            (t.type === "CC" && t.subtype === "Assigned"))
      )
      .sort((a, b) => a.close_date.localeCompare(b.close_date))[0] ?? null;

  const lifespanStatus      = disposalTrade ? "closed" : "active";
  const effectiveDisposalDate = disposalTrade?.close_date ?? today;

  // CCs written during the lifespan window
  const ccTrades = allTickerTrades
    .filter(
      (t) =>
        t.type === "CC" &&
        t.open_date >= assignmentDate &&
        t.close_date <= effectiveDisposalDate
    )
    .sort((a, b) => (a.open_date ?? "").localeCompare(b.open_date ?? ""));

  // Duration
  const daysAct    = daysBetween(assignmentDate, effectiveDisposalDate);
  const capitalDays = round2(initialCapital * daysAct);

  // P&L components
  const ccPremiumTotal   = round2(ccTrades.reduce((s, t) => s + (parseFloat(t.premium_collected) || 0), 0));
  const ccPremiumWinning = round2(ccTrades.filter((t) => (parseFloat(t.premium_collected) || 0) > 0)
    .reduce((s, t) => s + (parseFloat(t.premium_collected) || 0), 0));
  const ccPremiumLosing  = round2(ccTrades.filter((t) => (parseFloat(t.premium_collected) || 0) < 0)
    .reduce((s, t) => s + (parseFloat(t.premium_collected) || 0), 0));

  // Exit event
  let exitEvent        = null;
  let shareDisposalPnl = null;

  if (disposalTrade) {
    let exitType  = "manual_sale";
    let exitPrice = null;

    if (disposalTrade.type === "CC" && disposalTrade.subtype === "Assigned") {
      exitType  = "called_away";
      exitPrice = parseFloat(disposalTrade.strike) || null;
    } else {
      // Shares Sold/Exit — coordinated_exit if a CC also closed the same day
      const sameDayCcClose = allTickerTrades.find(
        (t) =>
          t.type === "CC" &&
          (t.subtype === "Close" || t.subtype === "Roll Loss") &&
          t.close_date === disposalTrade.close_date
      );
      exitType  = sameDayCcClose ? "coordinated_exit" : "manual_sale";
      exitPrice = parseFloat(disposalTrade.strike) || null;
    }

    shareDisposalPnl =
      exitPrice != null ? round2((exitPrice - assignmentPrice) * shares) : null;

    exitEvent = {
      date:                   disposalTrade.close_date,
      exit_type:              exitType,
      exit_price:             exitPrice,
      shares_disposed:        shares,
      share_disposal_pnl:     shareDisposalPnl,
      triggering_decision_id: null,
    };
  }

  const totalLifespanPnl =
    lifespanStatus === "closed" && shareDisposalPnl != null
      ? round2(cspPremium + ccPremiumTotal + shareDisposalPnl)
      : null;

  // Rate metrics — null if active, days < 1, or no capital
  const canRate    = daysAct >= 1 && initialCapital > 0 && totalLifespanPnl != null;
  const returnPct  = canRate ? round6(totalLifespanPnl / initialCapital) : null;
  const annualPct  = canRate ? round6(returnPct * (365 / daysAct)) : null;
  const returnPerCapDay = canRate && capitalDays > 0
    ? +(totalLifespanPnl / capitalDays).toFixed(8)
    : null;

  // --- SPAXX benchmark ---
  const spaxxReturn  = round2(initialCapital * 0.04 * (daysAct / 365));
  const spaxxVsActual =
    totalLifespanPnl != null ? round2(totalLifespanPnl - spaxxReturn) : null;
  const spaxxVerdict =
    lifespanStatus === "active"
      ? "active"
      : spaxxVsActual != null && spaxxVsActual >= 0
      ? "outperformed"
      : "underperformed";

  // --- Cut-and-redeploy benchmark ---
  const { avg_return_per_capital_day, sample_size } = cspBaseline;
  let cutAndRedeploy;

  if (spotAtAssignment == null) {
    cutAndRedeploy = {
      requires_spot_at_assignment:    true,
      sell_at_assignment_recovery:    null,
      realized_loss_at_assignment:    null,
      capital_to_redeploy:            null,
      avg_csp_return_per_capital_day: avg_return_per_capital_day,
      sample_size_csps_used:          sample_size,
      estimated_csp_pnl_over_lifespan: null,
      net_outcome_if_cut_and_redeploy: null,
      vs_actual_pnl:                  null,
      verdict:                        "data_missing",
    };
  } else {
    const sellRecovery       = round2(spotAtAssignment * shares);
    const realizedLoss       = round2(initialCapital - sellRecovery);
    const capitalToRedeploy  = sellRecovery;
    const estCspPnl          =
      avg_return_per_capital_day > 0
        ? round2(capitalToRedeploy * avg_return_per_capital_day * daysAct)
        : 0;
    const netOutcome  = round2(-realizedLoss + estCspPnl);
    const vsActual    = totalLifespanPnl != null ? round2(totalLifespanPnl - netOutcome) : null;
    const verdict     =
      lifespanStatus === "active"
        ? "active"
        : vsActual != null && vsActual >= 0
        ? "outperformed"
        : "underperformed";

    cutAndRedeploy = {
      requires_spot_at_assignment:     true,
      sell_at_assignment_recovery:     sellRecovery,
      realized_loss_at_assignment:     realizedLoss,
      capital_to_redeploy:             capitalToRedeploy,
      avg_csp_return_per_capital_day:  avg_return_per_capital_day,
      sample_size_csps_used:           sample_size,
      estimated_csp_pnl_over_lifespan: estCspPnl,
      net_outcome_if_cut_and_redeploy: netOutcome,
      vs_actual_pnl:                   vsActual,
      verdict,
    };
  }

  // --- Data completeness & warnings ---
  const warnings = [];
  if (daysAct < 1) {
    warnings.push("days_active < 1: same-day assignment and exit; rate-based metrics are null");
  }
  if (sample_size < 10) {
    warnings.push(
      `CSP baseline uses only ${sample_size} sample${sample_size === 1 ? "" : "s"} (< 10); ` +
        "cut-and-redeploy estimate is low-confidence"
    );
  }
  if (nextAssignmentDate) {
    warnings.push(
      `Another ${tickerUpper} assignment found on ${nextAssignmentDate}; ` +
        "verify these lifespans do not overlap"
    );
  }

  // --- CC history (journal context filled in by finalizeLifespan) ---
  const ccHistory = ccTrades.map((t) => ({
    trade_id:              t.id,
    open_date:             t.open_date,
    close_date:            t.close_date,
    strike:                parseFloat(t.strike) || t.strike,
    contracts:             t.contracts,
    premium_collected:     round2(parseFloat(t.premium_collected) || 0),
    kept_pct:              t.kept_pct ?? null,
    days_held:             t.days_held,
    relative_to_assignment:
      parseFloat(t.strike) > assignmentPrice
        ? "above"
        : parseFloat(t.strike) === assignmentPrice
        ? "at"
        : "below",
    is_winning:            (parseFloat(t.premium_collected) || 0) > 0,
    journal_context_summary: null,
  }));

  // --- Lifespan decisions ---
  const lifespanTrades = [
    triggeringCsp,
    ...ccTrades,
    ...(disposalTrade ? [disposalTrade] : []),
  ];
  const lifespanDecisions = clusterLifespanDecisions(lifespanTrades, tickerUpper);

  // Trade IDs for journal fetch (single-lifespan mode)
  const tradeIds = lifespanTrades.map((t) => t.id).filter(Boolean);

  return {
    ticker:           tickerUpper,
    assignment_id:    assignmentDate,
    lifespan_status:  lifespanStatus,

    assignment_event: {
      date:                  assignmentDate,
      triggering_csp_id:     triggeringCsp.id,
      csp_strike:            assignmentPrice,
      csp_premium_collected: round2(cspPremium),
      shares,
      assignment_price:      assignmentPrice,
      spot_at_assignment:    spotAtAssignment,
      initial_capital:       initialCapital,
    },

    exit_event: exitEvent,

    lifespan_metrics: {
      days_active:           daysAct,
      capital_days:          capitalDays,
      csp_premium_collected: round2(cspPremium),
      cc_premium_total:      ccPremiumTotal,
      cc_premium_winning:    ccPremiumWinning,
      cc_premium_losing:     ccPremiumLosing,
      share_disposal_pnl:    shareDisposalPnl,
      total_lifespan_pnl:    totalLifespanPnl,
      cc_count_total:        ccTrades.length,
      cc_count_winning:      ccTrades.filter((t) => (parseFloat(t.premium_collected) || 0) > 0).length,
      cc_count_losing:       ccTrades.filter((t) => (parseFloat(t.premium_collected) || 0) < 0).length,
      return_pct_on_capital: returnPct,
      annualized_return_pct: annualPct,
      return_per_capital_day: returnPerCapDay,
    },

    cc_history:         ccHistory,
    lifespan_decisions: lifespanDecisions,

    benchmarks: {
      spaxx_baseline: {
        annual_rate:    0.04,
        total_return:   spaxxReturn,
        vs_actual_pnl:  spaxxVsActual,
        verdict:        spaxxVerdict,
      },
      cut_and_redeploy_baseline: cutAndRedeploy,
    },

    computed_at: new Date().toISOString(),
    data_completeness: {
      has_spot_at_assignment: spotAtAssignment != null,
      has_all_ccs:            true,
      has_disposal_event:     lifespanStatus === "closed",
      warnings,
    },

    _tradeIds: tradeIds,
  };
}

// Attach journal context summaries to cc_history entries; strip _tradeIds.
function finalizeLifespan(lifespan, linkedJournals) {
  const journalByTradeId = {};
  for (const j of linkedJournals) {
    if (j.trade_id && !journalByTradeId[j.trade_id]) {
      journalByTradeId[j.trade_id] = j;
    }
  }

  const cc_history = lifespan.cc_history.map((cc) => ({
    ...cc,
    journal_context_summary:
      journalByTradeId[cc.trade_id]?.body?.slice(0, 200) ?? null,
  }));

  const { _tradeIds, ...rest } = lifespan;
  return { ...rest, cc_history };
}

// ---------------------------------------------------------------------------
// Decision clustering (lifespan-scoped)
// ---------------------------------------------------------------------------

function clusterLifespanDecisions(trades, ticker) {
  const decisions = [];
  let counter = 0;
  const nextId = () => `ld_${String(++counter).padStart(3, "0")}`;
  const assigned = new Set();

  // 1. CSP assignment — the triggering event
  const cspAssigned = trades.find((t) => t.type === "CSP" && t.subtype === "Assigned");
  if (cspAssigned) {
    decisions.push({
      decision_id:   nextId(),
      decision_type: "assignment_taken",
      decision_date: cspAssigned.close_date,
      summary:       `${ticker} CSP $${cspAssigned.strike} ${cspAssigned.expiry_date} assigned`,
      net_pnl:       round2(parseFloat(cspAssigned.premium_collected) || 0),
    });
    assigned.add(cspAssigned.id);
  }

  // 2. CC rolls (close + new CC within 3 days, different contract)
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

  // 3. CC assigned (called away) — typically also the disposal event
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

  // 4. Shares sold
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

  // 5. Remaining individual CC closes
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

function computeCspBaseline(cspTrades) {
  const returns = cspTrades
    .map((t) => {
      const premium = parseFloat(t.premium_collected) || 0;
      const capital = parseFloat(t.capital_fronted) || 0;
      const days    = parseFloat(t.days_held) || 0;
      if (capital <= 0 || days <= 0) return null;
      return premium / (capital * days);
    })
    .filter((r) => r != null);

  const avg =
    returns.length > 0
      ? returns.reduce((s, r) => s + r, 0) / returns.length
      : 0;

  return {
    avg_return_per_capital_day: avg,
    sample_size: returns.length,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function daysBetween(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const from = new Date(fromDate + "T00:00:00Z");
  const to   = new Date(toDate + "T00:00:00Z");
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
