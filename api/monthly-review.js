/**
 * api/monthly-review.js — Vercel serverless function
 *
 * GET /api/monthly-review?year=2026&month=4
 *
 * Returns a structured payload covering the 7 sections of the monthly review
 * skill template. All data comes from persisted tables — no live lookups.
 * Safe to call for any past month; works for in-progress months too (is_complete=false).
 */

import { createClient } from "@supabase/supabase-js";
import { MONTHLY_TARGETS } from "../src/lib/monthlyTargets.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const year  = parseInt(req.query.year,  10);
  const month = parseInt(req.query.month, 10);

  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ ok: false, error: "year and month (1-12) are required" });
  }

  const pad         = (n) => String(n).padStart(2, "0");
  const monthStart  = `${year}-${pad(month)}-01`;
  const lastDay     = new Date(year, month, 0).getDate();
  const monthEnd    = `${year}-${pad(month)}-${pad(lastDay)}`;

  const nextYear    = month === 12 ? year + 1 : year;
  const nextMonth   = month === 12 ? 1 : month + 1;
  const nextStart   = `${nextYear}-${pad(nextMonth)}-01`;
  const nextLastDay = new Date(nextYear, nextMonth, 0).getDate();
  const nextEnd     = `${nextYear}-${pad(nextMonth)}-${pad(nextLastDay)}`;

  const today       = new Date().toISOString().slice(0, 10);
  const is_complete = today > monthEnd;

  try {
    const supabase = getSupabase();

    // --- Batch 1: primary data sources (all parallel) ---
    const [
      dailySnapshotsResult,
      tradesResult,
      journalEntriesResult,
      macroSnapshotsResult,
      monthlyTargetResult,
      forecastCalResult,
      breachHistoryResult,
      nextMonthEarningsResult,
    ] = await Promise.all([
      supabase
        .from("daily_snapshots")
        .select("*")
        .gte("snapshot_date", monthStart)
        .lte("snapshot_date", monthEnd)
        .order("snapshot_date", { ascending: true }),

      supabase
        .from("trades")
        .select("*")
        .gte("close_date", monthStart)
        .lte("close_date", monthEnd)
        .order("close_date", { ascending: true }),

      supabase
        .from("journal_entries")
        .select("id, entry_type, entry_date, ticker, title, body, tags, mood, trade_id, position_id")
        .gte("entry_date", monthStart)
        .lte("entry_date", monthEnd)
        .order("entry_date", { ascending: true }),

      supabase
        .from("macro_snapshots")
        .select("*")
        .gte("snapshot_date", monthStart)
        .lte("snapshot_date", monthEnd)
        .order("snapshot_date", { ascending: true }),

      // Falls back to hardcoded if table doesn't exist yet
      supabase
        .from("monthly_targets")
        .select("baseline, stretch")
        .eq("year", year)
        .eq("month", month)
        .maybeSingle(),

      supabase
        .from("forecast_calibration")
        .select("*")
        .order("calibration_date", { ascending: false }),

      supabase
        .from("assigned_share_breach_history")
        .select("*")
        .gte("snapshot_date", monthStart)
        .lte("snapshot_date", monthEnd)
        .order("snapshot_date", { ascending: false }),

      supabase
        .from("quotes")
        .select("symbol, earnings_date, earnings_meta")
        .gte("earnings_date", nextStart)
        .lte("earnings_date", nextEnd)
        .not("earnings_date", "is", null)
        .order("earnings_date", { ascending: true }),
    ]);

    if (dailySnapshotsResult.error)  throw new Error(`daily_snapshots: ${dailySnapshotsResult.error.message}`);
    if (tradesResult.error)          throw new Error(`trades: ${tradesResult.error.message}`);
    if (journalEntriesResult.error)  throw new Error(`journal_entries: ${journalEntriesResult.error.message}`);
    if (macroSnapshotsResult.error)  throw new Error(`macro_snapshots: ${macroSnapshotsResult.error.message}`);
    if (forecastCalResult.error)     throw new Error(`forecast_calibration: ${forecastCalResult.error.message}`);
    if (breachHistoryResult.error)   throw new Error(`assigned_share_breach_history: ${breachHistoryResult.error.message}`);

    const dailySnapshots     = dailySnapshotsResult.data     ?? [];
    const trades             = tradesResult.data             ?? [];
    const journalEntries     = journalEntriesResult.data     ?? [];
    const macroSnapshots     = macroSnapshotsResult.data     ?? [];
    const forecastCalibration = forecastCalResult.data       ?? [];
    const breachHistory      = breachHistoryResult.data      ?? [];
    const nextMonthEarnings  = nextMonthEarningsResult.data  ?? [];

    // monthly_targets: fall back to hardcoded if table missing or no row
    const targetRow = !monthlyTargetResult.error ? monthlyTargetResult.data : null;
    const target = targetRow ?? { baseline: MONTHLY_TARGETS.baseline, stretch: MONTHLY_TARGETS.stretch };

    // --- Batch 2: position trajectories for trades closed this month ---
    const positionKeys = trades
      .filter((t) => t.ticker && t.type && t.strike && t.expiry_date)
      .map((t) => `${t.ticker}|${t.type}|${t.strike}|${t.expiry_date}`);

    const tradeIds = trades.map((t) => t.id).filter(Boolean);

    const [positionStateResult, linkedJournalResult] = await Promise.all([
      positionKeys.length > 0
        ? supabase
            .from("position_daily_state")
            .select("*")
            .in("position_key", positionKeys)
            .gte("snapshot_date", monthStart)
            .lte("snapshot_date", monthEnd)
            .order("snapshot_date", { ascending: true })
        : Promise.resolve({ data: [], error: null }),

      tradeIds.length > 0
        ? supabase
            .from("journal_entries")
            .select("id, entry_date, title, body, tags, trade_id")
            .in("trade_id", tradeIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (positionStateResult.error) throw new Error(`position_daily_state: ${positionStateResult.error.message}`);
    if (linkedJournalResult.error) throw new Error(`journal_entries (linked): ${linkedJournalResult.error.message}`);

    const positionState    = positionStateResult.data  ?? [];
    const linkedJournals   = linkedJournalResult.data  ?? [];

    // Build lookup indexes
    const stateByKey = {};
    for (const row of positionState) {
      if (!stateByKey[row.position_key]) stateByKey[row.position_key] = [];
      stateByKey[row.position_key].push(row);
    }

    const journalIdsByTradeId = {};
    for (const e of linkedJournals) {
      if (e.trade_id) {
        if (!journalIdsByTradeId[e.trade_id]) journalIdsByTradeId[e.trade_id] = [];
        journalIdsByTradeId[e.trade_id].push(e.id);
      }
    }

    // Snapshot bookends
    const firstSnap = dailySnapshots[0]    ?? null;
    const lastSnap  = dailySnapshots.at(-1) ?? null;

    // -------------------------------------------------------------------------
    // Section 1: Financial Snapshot
    // -------------------------------------------------------------------------
    const mtdRealized          = lastSnap?.forecast_realized_to_date ?? lastSnap?.mtd_premium_collected ?? null;
    const forecastAtMonthStart = firstSnap?.forecast_month_total ?? null;

    const financial_snapshot = {
      target_baseline:         target.baseline,
      target_stretch:          target.stretch,
      mtd_realized:            mtdRealized,
      vs_baseline_pct:         mtdRealized != null ? +(mtdRealized / target.baseline).toFixed(4) : null,
      vs_baseline_dollar:      mtdRealized != null ? +(mtdRealized - target.baseline).toFixed(2) : null,
      vs_stretch_pct:          mtdRealized != null ? +(mtdRealized / target.stretch).toFixed(4) : null,
      trade_count_closed:      trades.length,
      account_value_start:     firstSnap?.account_value ?? null,
      account_value_end:       lastSnap?.account_value  ?? null,
      account_value_change:
        firstSnap && lastSnap
          ? +(lastSnap.account_value - firstSnap.account_value).toFixed(2)
          : null,
      forecast_at_month_start: forecastAtMonthStart,
      forecast_at_month_end:   lastSnap?.forecast_month_total ?? null,
      forecast_accuracy_pct:
        forecastAtMonthStart && mtdRealized
          ? +(mtdRealized / forecastAtMonthStart).toFixed(4)
          : null,
      by_type: aggregateByType(trades),
    };

    // -------------------------------------------------------------------------
    // Section 2: Portfolio Composition
    // -------------------------------------------------------------------------
    const deployedValues = dailySnapshots.map((s) => s.total_deployed_pct).filter((v) => v != null);
    const vixValues      = dailySnapshots.map((s) => s.vix).filter((v) => v != null);
    const macroVix       = macroSnapshots.map((s) => s.vix).filter((v) => v != null);

    const phaseTransitions = [];
    for (let i = 1; i < dailySnapshots.length; i++) {
      const prev = dailySnapshots[i - 1];
      const curr = dailySnapshots[i];
      if (prev.pipeline_phase !== curr.pipeline_phase) {
        phaseTransitions.push({ date: curr.snapshot_date, from: prev.pipeline_phase, to: curr.pipeline_phase });
      }
    }

    // Latest breach state per ticker (breach history is sorted desc)
    const breachByTicker = {};
    for (const row of breachHistory) {
      if (!breachByTicker[row.ticker]) breachByTicker[row.ticker] = row;
    }

    const portfolio_composition = {
      month_end: lastSnap ? {
        open_csp_count:          lastSnap.open_csp_count,
        open_cc_count:           lastSnap.open_cc_count,
        open_leaps_count:        lastSnap.open_leaps_count,
        assigned_share_tickers:  lastSnap.assigned_share_tickers,
        total_open_positions:    lastSnap.total_open_positions,
        total_deployed_pct:      lastSnap.total_deployed_pct,
        free_cash_pct:           lastSnap.free_cash_pct,
        vix:                     lastSnap.vix,
        vix_band:                lastSnap.vix_band,
        pipeline_phase:          lastSnap.pipeline_phase,
        ticker_allocations:      lastSnap.ticker_allocations,
        concentration_flags: {
          any_above_10pct:       lastSnap.any_ticker_above_10pct,
          any_above_15pct:       lastSnap.any_ticker_above_15pct,
        },
        within_vix_band:         lastSnap.within_band,
        overdeployed:            lastSnap.overdeployed,
        underdeployed:           lastSnap.underdeployed,
      } : null,

      drift_over_month: {
        deployment_range: deployedValues.length
          ? [+Math.min(...deployedValues).toFixed(4), +Math.max(...deployedValues).toFixed(4)]
          : null,
        phase_transitions: phaseTransitions,
        vix_range: vixValues.length
          ? [+Math.min(...vixValues).toFixed(2), +Math.max(...vixValues).toFixed(2)]
          : null,
        snapshot_series: dailySnapshots.map((s) => ({
          date:         s.snapshot_date,
          deployed_pct: s.total_deployed_pct,
          free_cash_pct: s.free_cash_pct,
          vix:          s.vix,
          phase:        s.pipeline_phase,
          within_band:  s.within_band,
          mtd_collected: s.forecast_realized_to_date ?? s.mtd_premium_collected,
        })),
      },

      assigned_share_income: lastSnap ? {
        total_capacity:  lastSnap.assigned_share_income_total,
        on_target:       lastSnap.assigned_share_income_on_target,
        by_band: {
          healthy:    lastSnap.assigned_share_income_healthy,
          recovering: lastSnap.assigned_share_income_recovering,
          grinding:   lastSnap.assigned_share_income_grinding,
        },
        per_position: lastSnap.assigned_share_income_per_position,
      } : null,
    };

    // -------------------------------------------------------------------------
    // Section 3: Execution Quality
    // -------------------------------------------------------------------------
    const allTags       = journalEntries.flatMap((e) => e.tags ?? []);
    const frameworkCounts = countByCategory(allTags, "framework");

    const trades_with_context = trades.map((t) => {
      const key = t.ticker && t.type && t.strike && t.expiry_date
        ? `${t.ticker}|${t.type}|${t.strike}|${t.expiry_date}`
        : null;
      return {
        id:                      t.id,
        ticker:                  t.ticker,
        type:                    t.type,
        subtype:                 t.subtype,
        strike:                  t.strike,
        contracts:               t.contracts,
        open_date:               t.open_date,
        close_date:              t.close_date,
        expiry_date:             t.expiry_date,
        days_held:               t.days_held,
        premium_collected:       t.premium_collected,
        kept_pct:                t.kept_pct,
        roi:                     t.roi,
        capital_fronted:         t.capital_fronted,
        notes:                   t.notes,
        linked_journal_entry_ids: journalIdsByTradeId[t.id] ?? [],
        // Daily trajectory during the month for grading (profit%, DTE, stock price)
        position_daily_trajectory: key ? (stateByKey[key] ?? []) : [],
      };
    });

    const execution_quality = {
      trades_this_month: trades_with_context,
      framework_compliance_summary: {
        "60-60-applied":          frameworkCounts["60-60-applied"]      ?? 0,
        "60-60-skipped":          frameworkCounts["60-60-skipped"]      ?? 0,
        "conditions-based-close": frameworkCounts["conditions-based-close"] ?? 0,
        "expiry-cleanup":         frameworkCounts["expiry-cleanup"]     ?? 0,
        "early-close":            frameworkCounts["early-close"]        ?? 0,
      },
    };

    // -------------------------------------------------------------------------
    // Section 4: Behavioral Patterns
    // -------------------------------------------------------------------------
    const tagsByCategory = aggregateByCategory(allTags);

    // Drift-tagged dates: dates where any drift: tag appears, clustered at 2+
    const driftByDate = {};
    for (const e of journalEntries) {
      const driftTags = (e.tags ?? []).filter((t) => t.startsWith("drift:"));
      if (driftTags.length) {
        if (!driftByDate[e.entry_date]) driftByDate[e.entry_date] = [];
        driftByDate[e.entry_date].push(...driftTags);
      }
    }
    const driftClusteredDays = Object.entries(driftByDate)
      .filter(([, tags]) => tags.length >= 2)
      .map(([date, tags]) => ({ date, tags }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const driftDates = new Set(Object.keys(driftByDate));
    const drift_tagged_trades = trades
      .filter((t) => t.close_date && driftDates.has(t.close_date))
      .map((t) => ({ id: t.id, ticker: t.ticker, type: t.type, close_date: t.close_date, kept_pct: t.kept_pct }));

    const behavioral_patterns = {
      tag_frequency_by_category: tagsByCategory,
      drift_clustered_days:      driftClusteredDays,
      drift_tagged_trades,
      journal_entry_count:       journalEntries.length,
      mood_distribution:         aggregateMoods(journalEntries),
    };

    // -------------------------------------------------------------------------
    // Section 5: Key Learnings
    // -------------------------------------------------------------------------
    const LEARNING_TAGS = new Set(["framework:gap-identified", "review:key-learning"]);
    const tagged_entries = journalEntries.filter((e) =>
      (e.tags ?? []).some((t) => LEARNING_TAGS.has(t))
    );
    const weekly_review_entries = journalEntries.filter((e) => e.entry_type === "weekly_review");

    const key_learnings = { tagged_entries, weekly_review_entries };

    // -------------------------------------------------------------------------
    // Section 6: Macro Context
    // -------------------------------------------------------------------------
    const postureTransitions = [];
    for (let i = 1; i < macroSnapshots.length; i++) {
      const prev = macroSnapshots[i - 1];
      const curr = macroSnapshots[i];
      if (prev.posture !== curr.posture) {
        postureTransitions.push({
          date:  curr.snapshot_date,
          from:  prev.posture,
          to:    curr.posture,
          score: curr.posture_score,
        });
      }
    }

    const scoreSum = macroSnapshots.reduce((s, r) => s + (r.posture_score ?? 0), 0);

    const macro_context = {
      vix_start:        macroSnapshots[0]?.vix     ?? null,
      vix_end:          macroSnapshots.at(-1)?.vix  ?? null,
      vix_high:         macroVix.length ? +Math.max(...macroVix).toFixed(2) : null,
      vix_low:          macroVix.length ? +Math.min(...macroVix).toFixed(2) : null,
      posture_transitions: postureTransitions,
      posture_score_avg:
        macroSnapshots.length ? +(scoreSum / macroSnapshots.length).toFixed(2) : null,
      snapshot_series: macroSnapshots.map((s) => ({
        date:            s.snapshot_date,
        vix:             s.vix,
        posture:         s.posture,
        posture_score:   s.posture_score,
        s5fi_pct:        s.s5fi_pct,
        fear_greed_score: s.fear_greed_score,
      })),
    };

    // -------------------------------------------------------------------------
    // Section 7: Next Month Setup
    // -------------------------------------------------------------------------
    const latestCalDate = forecastCalibration[0]?.calibration_date ?? null;
    const latestCal     = latestCalDate
      ? forecastCalibration.filter((r) => r.calibration_date === latestCalDate)
      : [];

    const next_month_setup = {
      month_end_pipeline: lastSnap ? {
        forward_pipeline_premium: lastSnap.forward_pipeline_premium,
        csp_share:                lastSnap.csp_pipeline_premium,
        cc_share:                 lastSnap.cc_pipeline_premium,
        below_cost_cc_premium:    lastSnap.below_cost_cc_premium,
        phase:                    lastSnap.pipeline_phase,
        forecast_per_position:    lastSnap.forecast_per_position,
      } : null,
      assigned_share_risk: {
        month_end_breach_status: Object.values(breachByTicker),
      },
      earnings_in_next_month: nextMonthEarnings.map((q) => ({
        ticker:       q.symbol,
        earnings_date: q.earnings_date,
        hour:         q.earnings_meta?.hour        ?? null,
        confidence:   q.earnings_meta?.confidence  ?? null,
      })),
    };

    // -------------------------------------------------------------------------
    // Forecast Calibration (reference data)
    // -------------------------------------------------------------------------
    const forecast_calibration_snapshot = {
      current_calibration_date: latestCalDate,
      csp_buckets: latestCal
        .filter((r) => r.position_type === "csp")
        .map((r) => ({ bucket: r.bucket, calibrated_capture: r.calibrated_capture, sample_size: r.sample_size, notes: r.notes })),
      cc_buckets: latestCal
        .filter((r) => r.position_type === "cc")
        .map((r) => ({ bucket: r.bucket, calibrated_capture: r.calibrated_capture, sample_size: r.sample_size, notes: r.notes })),
    };

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({
      ok:               true,
      month:            `${year}-${pad(month)}`,
      month_start_date: monthStart,
      month_end_date:   monthEnd,
      is_complete,
      financial_snapshot,
      portfolio_composition,
      execution_quality,
      behavioral_patterns,
      key_learnings,
      macro_context,
      next_month_setup,
      forecast_calibration: forecast_calibration_snapshot,
    });
  } catch (err) {
    console.error("[api/monthly-review] Error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// --- Helpers ---

function aggregateByType(trades) {
  const result = {};
  for (const t of trades) {
    const type = t.type ?? "unknown";
    if (!result[type]) result[type] = { count: 0, premium_total: 0 };
    result[type].count++;
    result[type].premium_total += t.premium_collected ?? 0;
  }
  return result;
}

function countByCategory(tags, category) {
  const result = {};
  for (const tag of tags) {
    const idx = tag.indexOf(":");
    if (idx === -1) continue;
    const cat = tag.slice(0, idx);
    const val = tag.slice(idx + 1);
    if (cat === category) result[val] = (result[val] ?? 0) + 1;
  }
  return result;
}

function aggregateByCategory(tags) {
  const result = {};
  for (const tag of tags) {
    const idx = tag.indexOf(":");
    if (idx === -1) continue;
    const cat = tag.slice(0, idx);
    const val = tag.slice(idx + 1);
    if (!result[cat]) result[cat] = {};
    result[cat][val] = (result[cat][val] ?? 0) + 1;
  }
  return result;
}

function aggregateMoods(entries) {
  const result = {};
  for (const e of entries) {
    if (e.mood) result[e.mood] = (result[e.mood] ?? 0) + 1;
  }
  return result;
}
