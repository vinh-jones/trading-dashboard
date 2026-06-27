/**
 * api/eod-snapshot.js — Vercel serverless function
 *
 * GET /api/eod-snapshot
 *
 * Returns a full EOD snapshot in JSON + pre-formatted text suitable for
 * pasting into Claude Chat for daily review. Covers:
 *   - Account summary (free cash, MTD, pipeline, VIX band)
 *   - Market prices (SPY, QQQ with daily change)
 *   - Macro signals (all 7 from /api/macro + posture)
 *   - Open positions (CSPs, Covered Calls, Assigned Shares, LEAPs)
 *   - Portfolio allocation by ticker
 *   - Today's journal entries (trade notes + EOD update text)
 *   - Radar universe (53 tickers with last price + IV + BB position)
 *
 * No auth required — read-only, no sensitive secrets exposed.
 * No sync triggered — reads cached data only.
 */

import { createClient } from "@supabase/supabase-js";
import { reshapePositions } from "./_lib/reshapePositions.js";
import { computeForecastV2, pipelineSnapshotFields } from "./_lib/computeForecastV2.js";
import { getVixBand } from "../src/lib/vixBand.js";
import { computeCushion } from "../src/lib/cushionBreach.js";
import { buildSnapshotRisk } from "./_lib/snapshotRisk.js";
import {
  detectLifespans,
  buildLifespan,
  computeCspBaseline,
  computeDecisionFraming,
} from "./_lib/lifespan.js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

async function fetchYahooQuote(symbol) {
  const encoded = encodeURIComponent(symbol);
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=1d`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
    }
  );
  if (!res.ok) throw new Error(`Yahoo ${symbol} returned ${res.status}`);
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`Missing chart meta for ${symbol}`);
  const last = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose;
  const change = Math.round((last - prevClose) * 100) / 100;
  const changePct = Math.round(((last - prevClose) / prevClose) * 10000) / 100;
  return { last, prevClose, change, changePct };
}

// ─── Text formatting helpers ─────────────────────────────────────────

function fmt$(n, decimals = 0) {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (n < 0 ? "-$" : "$") + formatted;
}

function fmtPct(n, decimals = 1) {
  if (n == null) return "—";
  return `${(n * 100).toFixed(decimals)}%`;
}

function fmtChange(change, changePct) {
  if (change == null) return "";
  const sign = change >= 0 ? "+" : "";
  return `${sign}$${Math.abs(change).toFixed(2)} (${sign}${changePct?.toFixed(2)}%)`;
}

function pad(s, w) {
  return String(s ?? "").padEnd(w);
}

// One-line recovery-gauge summary for the EOD debrief. Replaces the old
// constant-rate "~N months" / recovery_date phrasing with horizon-scaled
// sigmas + touch odds (band, not a false-precise decimal). Returns null when
// there is no recovery object to render.
function formatRecoveryLine(recovery) {
  if (!recovery) return null;
  const r = recovery;
  if (r.recovery_sigmas == null) {
    return `breakeven $${r.breakeven?.toFixed?.(2) ?? r.breakeven} · recovery — (no IV)`;
  }
  const bandLabel = r.reachability_band[0].toUpperCase() + r.reachability_band.slice(1);
  const touchPct = Math.round(r.touch_prob * 100);
  let line = `breakeven $${r.breakeven.toFixed(2)} · ${r.recovery_sigmas}σ over ${r.horizon_label} · ${bandLabel} (~${touchPct}%)`;
  if (r.touch_prob_cc_cycle != null) {
    line += ` · this cycle ~${Math.round(r.touch_prob_cc_cycle * 100)}%`;
  }
  return line;
}

// Fetch all CSP/CC/Shares trades for the given tickers, used to rebuild
// per-ticker lifespans for decision_framing computation in the EOD snapshot.
async function fetchTickerTrades(supabase, tickers) {
  if (!tickers || tickers.length === 0) return {};
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .in("ticker", tickers)
    .order("close_date", { ascending: true });
  if (error) {
    console.warn("[api/eod-snapshot] trades fetch failed:", error.message);
    return {};
  }
  const byTicker = {};
  for (const t of data ?? []) {
    if (!byTicker[t.ticker]) byTicker[t.ticker] = [];
    byTicker[t.ticker].push(t);
  }
  return byTicker;
}

// ─── Text blob builder ────────────────────────────────────────────────

function buildTextBlob({
  today,
  dailySnapshot,
  positions,
  journalEntries,
  macroAiContext,
  macroPosture,
  spyQuote,
  qqqQuote,
  radarRows,
  decisionFraming,
}) {
  const lines = [];

  const dateStr = new Date(today + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  lines.push(`EOD SNAPSHOT — ${dateStr}`);
  lines.push("═".repeat(60));
  lines.push("");

  // ── Account Summary ──
  if (dailySnapshot) {
    const ds = dailySnapshot;
    lines.push("ACCOUNT SUMMARY");
    lines.push("─".repeat(40));

    const cashPct = ds.free_cash_pct != null ? (ds.free_cash_pct * 100).toFixed(1) + "%" : "—";
    let bandStatus = "";
    if (ds.within_band) bandStatus = "✓ in band";
    else if (ds.overdeployed) bandStatus = "↑ above ceiling";
    else if (ds.underdeployed) bandStatus = "↓ below floor";

    const floorPct  = ds.cash_floor_target_pct    != null ? (ds.cash_floor_target_pct * 100).toFixed(0)    + "%" : null;
    const ceilPct   = ds.cash_ceiling_target_pct  != null ? (ds.cash_ceiling_target_pct * 100).toFixed(0)  + "%" : null;
    const bandRange = floorPct && ceilPct ? `Floor: ${floorPct}–${ceilPct}` : "";

    lines.push(`Free Cash: ${cashPct} ${bandStatus}${bandRange ? "  (" + bandRange + ")" : ""}`);
    lines.push(`Account Value: ${fmt$(ds.account_value)}`);
    lines.push(
      `MTD Realized: ${fmt$(ds.mtd_premium_collected)} | Pipeline Gross: ${fmt$(ds.open_premium_gross)}`
    );
    lines.push(
      `Forecast Month Total (v2): ${fmt$(ds.forecast_month_total)}`
    );
    if (ds.vix != null)
      lines.push(`VIX: ${ds.vix} · ${ds.vix_band ?? ""}`);
    lines.push(
      `Positions: ${ds.open_csp_count} CSPs · ${ds.open_cc_count} CCs · ${ds.open_leaps_count} LEAPs · ${ds.assigned_share_tickers} assigned tickers`
    );
    lines.push("");
  }

  // ── Market ──
  lines.push("MARKET");
  lines.push("─".repeat(40));
  if (spyQuote) {
    lines.push(`SPY: $${spyQuote.last.toFixed(2)} ${fmtChange(spyQuote.change, spyQuote.changePct)}`);
  }
  if (qqqQuote) {
    lines.push(`QQQ: $${qqqQuote.last.toFixed(2)} ${fmtChange(qqqQuote.change, qqqQuote.changePct)}`);
  }
  lines.push("");

  // ── Macro Signals ──
  if (macroPosture) {
    lines.push(
      `MACRO POSTURE: ${macroPosture.posture} (avg ${macroPosture.avg}/5)`
    );
    lines.push(macroPosture.deploymentGuidance ?? "");
    lines.push("");
  }
  if (macroAiContext) {
    lines.push(macroAiContext);
    lines.push("");
  }

  // ── Open CSPs ──
  const csps = positions?.open_csps ?? [];
  if (csps.length) {
    lines.push(`OPEN CSPs (${csps.length})`);
    lines.push("─".repeat(40));
    for (const p of csps) {
      const ror = p.roi != null ? `${(p.roi * 100).toFixed(2)}% RoR` : "";
      const cushionTag = p.cushion_state === "assignment_risk" ? "  [● ASSIGNMENT RISK]"
        : p.cushion_state === "approaching" ? "  [⚠ APPROACHING]"
        : "";
      lines.push(
        `${pad(p.ticker, 6)} $${p.strike}p  exp ${p.expiry_date} (${p.days_to_expiry}d) · ${fmt$(p.premium_collected)} premium · ${fmt$(p.capital_fronted)} capital${ror ? "  " + ror : ""}${cushionTag}`
      );
    }
    lines.push("");
  }

  // ── Assigned Shares + Covered Calls ──
  const shares = positions?.assigned_shares ?? [];
  if (shares.length) {
    lines.push(`ASSIGNED SHARES + COVERED CALLS (${shares.length})`);
    lines.push("─".repeat(40));
    for (const s of shares) {
      lines.push(
        `${s.ticker}  Shares · Cost basis: ${fmt$(s.cost_basis_total)}`
      );
      if (s.active_cc) {
        const cc = s.active_cc;
        const ror = cc.roi != null ? `  ${(cc.roi * 100).toFixed(2)}% RoR` : "";
        lines.push(
          `  ↳ CC $${cc.strike}c  exp ${cc.expiry_date} (${cc.days_to_expiry}d) · ${fmt$(cc.premium_collected)} premium${ror}`
        );
      } else {
        lines.push(`  ↳ No active CC`);
      }
    }
    lines.push("");
  }

  // ── Decision Framing ──
  if (decisionFraming && decisionFraming.length) {
    lines.push("DECISION FRAMING — ACTIVE ASSIGNED POSITIONS");
    lines.push("─".repeat(40));
    for (const f of decisionFraming) {
      const breakevenLabel = f.breakeven_zone
        .replace("wheel_ahead_perpetually", "Wheel ahead")
        .replace("quick_recovery", "Quick recovery")
        .replace("decision_zone", "Decision zone")
        .replace("long_horizon", "Long horizon")
        .replace("effectively_stuck", "Effectively stuck");
      const drawdownLabel = f.drawdown_zone[0].toUpperCase() + f.drawdown_zone.slice(1);
      lines.push(`${f.ticker} · ${drawdownLabel} / ${breakevenLabel}`);
      if (f.framing_question) lines.push(`  Q: "${f.framing_question}"`);
      const recoveryLine = formatRecoveryLine(f.recovery);
      if (recoveryLine) lines.push(`  ${recoveryLine}`);
    }

    // Footer two-line summary
    const decisionZone = decisionFraming.filter((f) => f.breakeven_zone === "decision_zone").map((f) => f.ticker);
    const anchored = decisionFraming
      .filter((f) => f.breakeven_zone === "long_horizon" || f.breakeven_zone === "effectively_stuck")
      .map((f) => f.ticker);

    if (decisionZone.length || anchored.length) lines.push("");
    if (decisionZone.length) lines.push(`DECISION ZONE (comparison most informative): ${decisionZone.join(", ")}`);
    if (anchored.length)     lines.push(`ANCHORED (math says hold despite long timeline): ${anchored.join(", ")}`);

    lines.push("");
  }

  // ── LEAPs ──
  const standaloneLeaps = positions?.open_leaps ?? [];
  const nestedLeaps = shares.flatMap((s) => s.open_leaps ?? []);
  const allLeaps = [...standaloneLeaps, ...nestedLeaps];
  if (allLeaps.length) {
    lines.push(`LEAPs (${allLeaps.length})`);
    lines.push("─".repeat(40));
    for (const l of allLeaps) {
      lines.push(
        `${pad(l.ticker, 6)} ${l.description ?? l.subtype ?? ""} · ${fmt$(l.capital_fronted)} capital · exp ${l.expiry_date ?? "—"}`
      );
    }
    lines.push("");
  }

  // ── Portfolio Allocation ──
  if (dailySnapshot?.ticker_allocations) {
    const alloc = Object.entries(dailySnapshot.ticker_allocations)
      .sort(([, a], [, b]) => b - a)
      .map(([ticker, pct]) => `${ticker} ${(pct * 100).toFixed(1)}%`);
    if (alloc.length) {
      lines.push("PORTFOLIO ALLOCATION");
      lines.push("─".repeat(40));
      lines.push(alloc.join("  |  "));
      lines.push("");
    }
  }

  // ── Today's Journal ──
  if (journalEntries.length) {
    lines.push(`TODAY'S JOURNAL (${journalEntries.length} entries)`);
    lines.push("─".repeat(40));
    // Trade notes first, EOD update last
    const tradeNotes = journalEntries.filter((e) => e.entry_type !== "eod_update");
    const eodUpdates = journalEntries.filter((e) => e.entry_type === "eod_update");
    for (const entry of [...tradeNotes, ...eodUpdates]) {
      if (entry.entry_type === "eod_update") {
        lines.push("[EOD UPDATE]");
      } else {
        const header = [entry.title, entry.ticker].filter(Boolean).join(" · ");
        if (header)
          lines.push(
            `[${(entry.entry_type ?? "NOTE").toUpperCase().replace("_", " ")}] ${header}`
          );
      }
      if (entry.body?.trim()) lines.push(entry.body.trim());
      lines.push("");
    }
  }

  // ── Radar Universe ──
  if (radarRows.length) {
    lines.push(`RADAR UNIVERSE (${radarRows.length} tickers)`);
    lines.push("─".repeat(40));
    lines.push(
      "TICKER  LAST     IV     IV_RANK  BB_POSITION"
    );
    for (const r of radarRows) {
      const bb = r.bb_position != null ? r.bb_position.toFixed(2) : "—";
      const iv = r.iv != null ? (r.iv * 100).toFixed(1) + "%" : "—";
      const ivr = r.iv_rank != null ? r.iv_rank.toFixed(0) : "—";
      const last = r.last != null ? "$" + r.last.toFixed(2) : "—";
      lines.push(
        `${pad(r.ticker, 6)}  ${pad(last, 8)} ${pad(iv, 6)} ${pad(ivr, 8)} ${bb}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Sheet allocation fetch ───────────────────────────────────────────
// Fetches the published Google Sheet CSV and returns per-ticker allocations
// as decimals (e.g. { SOFI: 0.098, PLTR: 0.1503, ... }) by summing the
// CSP %, Shares %, and LEAPS % columns for each ticker.
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLuYoqaPOxDPDCpw8re2P2KhVw9g3doBOMgsbL0VW9WjCPw4fsTx_DaB6pu0CwXNITSg9qKisheRPb/pub?gid=1249321251&single=true&output=csv";

async function fetchSheetAllocations() {
  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) throw new Error(`Sheet CSV returned ${res.status}`);
  const text = await res.text();
  const rows = text.split("\n").map(r => r.trim()).filter(Boolean);

  // Find the header row (contains "Ticker")
  const headerIdx = rows.findIndex(r => r.startsWith("Ticker,"));
  if (headerIdx < 0) throw new Error("Sheet header row not found");

  const parsePct = (str) => {
    if (!str) return 0;
    const n = parseFloat(str.replace(/["%]/g, "").trim());
    return isNaN(n) ? 0 : n / 100;
  };

  // Simple CSV split that handles quoted fields (e.g. "$153,951")
  const splitCsv = (line) => {
    const cols = [];
    let cur = "", inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === "," && !inQuote) { cols.push(cur); cur = ""; }
      else { cur += ch; }
    }
    cols.push(cur);
    return cols;
  };

  const totals = {};
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cols = splitCsv(rows[i]);
    const ticker = (cols[0] ?? "").trim();
    if (!ticker || ticker === "CASH") continue;
    const cspPct    = parsePct(cols[5]);
    const sharesPct = parsePct(cols[6]);
    const leapsPct  = parsePct(cols[7]);
    totals[ticker] = (totals[ticker] || 0) + cspPct + sharesPct + leapsPct;
  }
  return totals;
}

function enrichCspCushion(openCsps, quotesMap) {
  const missingIv = [];
  const enriched  = openCsps.map(p => {
    const q          = quotesMap[p.ticker];
    const underlying = q?.mid ?? q?.last ?? null;
    const iv         = q?.iv ?? null;
    if (iv == null) missingIv.push(p.ticker);
    const cushion    = computeCushion(p.strike, underlying, iv);
    return { ...p, ...cushion };
  });
  return { enriched, missingIv };
}

// ─── Main handler ────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const now   = new Date();
  const today = now.toISOString().slice(0, 10);
  const nowStr = now.toLocaleTimeString("en-US", {
    hour:     "numeric",
    minute:   "2-digit",
    timeZone: "America/Los_Angeles",
  }) + " PT";
  const supabase = getSupabase();

  // Fetch all Supabase data in parallel
  const [
    dailySnapshotResult,
    positionsResult,
    journalResult,
    universeResult,
    accountSnapshotResult,
  ] = await Promise.allSettled([
    supabase
      .from("daily_snapshots")
      .select("*")
      .eq("snapshot_date", today)
      .single(),
    supabase.from("positions").select("*").order("ticker"),
    supabase
      .from("journal_entries")
      .select("id, entry_type, entry_date, title, ticker, body, tags, mood, source")
      .eq("entry_date", today)
      .order("created_at", { ascending: true }),
    supabase
      .from("wheel_universe")
      .select("ticker, company, sector")
      .eq("list_type", "approved")
      .order("ticker"),
    supabase
      .from("account_snapshots")
      .select("*")
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .single(),
  ]);

  const positionRows =
    positionsResult.status === "fulfilled"
      ? positionsResult.value.data ?? []
      : [];
  let positions = reshapePositions(positionRows);

  const dailySnapshot =
    dailySnapshotResult.status === "fulfilled"
      ? dailySnapshotResult.value.data ?? null
      : null;

  const journalEntries =
    journalResult.status === "fulfilled"
      ? journalResult.value.data ?? []
      : [];

  const universeRows =
    universeResult.status === "fulfilled"
      ? universeResult.value.data ?? []
      : [];

  // Fetch radar quotes and market quotes in parallel
  const universeTickers = universeRows.map((u) => u.ticker);
  const [radarQuotesResult, spyResult, qqqResult, vixResult, macroResult, sheetAllocResult] =
    await Promise.allSettled([
      universeTickers.length
        ? supabase
            .from("quotes")
            .select("symbol, last, iv, iv_rank, bb_position, bb_sma20, bb_upper, bb_lower")
            .in("symbol", universeTickers)
        : Promise.resolve({ data: [] }),
      fetchYahooQuote("SPY"),
      fetchYahooQuote("QQQ"),
      fetchYahooQuote("^VIX"),
      // Check macro_snapshots for today's cached ai_context first
      supabase
        .from("macro_snapshots")
        .select("ai_context, posture, posture_score")
        .eq("snapshot_date", today)
        .single(),
      fetchSheetAllocations(),
    ]);

  // If no cached macro for today, call /api/macro live
  let macroAiContext = null;
  let macroPosture   = null;
  const cachedMacro  = macroResult.status === "fulfilled" ? macroResult.value.data : null;

  if (cachedMacro?.ai_context) {
    macroAiContext = cachedMacro.ai_context;
    macroPosture = cachedMacro.posture
      ? { posture: cachedMacro.posture, avg: cachedMacro.posture_score }
      : null;
  } else {
    try {
      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers.host;
      const macroRes = await fetch(`${protocol}://${host}/api/macro`, {
        headers: { "User-Agent": "internal-eod-snapshot" },
      });
      const macroData = await macroRes.json();
      if (macroData.ok) {
        macroAiContext = macroData.ai_context ?? null;
        macroPosture   = macroData.posture     ?? null;
      }
    } catch (err) {
      console.warn("[api/eod-snapshot] macro fetch failed:", err.message);
    }
  }

  // Build radar rows (universe + quotes merged)
  const quotesMap = {};
  const radarQuotes =
    radarQuotesResult.status === "fulfilled"
      ? radarQuotesResult.value.data ?? []
      : [];
  for (const q of radarQuotes) {
    quotesMap[q.symbol] = q;
  }
  const radarRows = universeRows.map((u) => {
    const q = quotesMap[u.ticker] ?? {};
    return {
      ticker:      u.ticker,
      company:     u.company,
      sector:      u.sector,
      last:        q.last        ?? null,
      iv:          q.iv          ?? null,
      iv_rank:     q.iv_rank     ?? null,
      bb_position: q.bb_position ?? null,
    };
  });

  let cushionMissingIv = [];
  const enrichResult = enrichCspCushion(positions.open_csps ?? [], quotesMap);
  positions        = { ...positions, open_csps: enrichResult.enriched };
  cushionMissingIv = enrichResult.missingIv;

  const spyQuote = spyResult.status === "fulfilled" ? spyResult.value : null;
  const qqqQuote = qqqResult.status === "fulfilled" ? qqqResult.value : null;
  const liveVix  = vixResult.status === "fulfilled"  ? vixResult.value.last : null;

  // Build effective snapshot — prefer today's daily_snapshot (written by 4:30 PM ET cron),
  // but fall back to live data so Claude always has account context even intraday.
  const accountSnap =
    accountSnapshotResult.status === "fulfilled"
      ? accountSnapshotResult.value.data ?? null
      : null;

  // Use daily_snapshot only when it has real account data.
  // If the cron wrote a partial row (account_value null — e.g. sync race), fall through
  // to the live accountSnap fallback the same as if no row existed yet.
  const dailySnapshotIsUsable = dailySnapshot && dailySnapshot.account_value != null;
  let effectiveSnapshot = dailySnapshotIsUsable ? dailySnapshot : null;
  if (!effectiveSnapshot && accountSnap) {
    const vix     = liveVix ?? accountSnap.vix_current ?? null;
    const band    = getVixBand(vix);
    const cashPct = accountSnap.free_cash_pct_est ?? null;

    // Pipeline from live positions (CSPs + active CCs + open credit spreads).
    // Credit spreads carry premium_collected = max_gain, so they sum into
    // openPremiumGross like any other premium source. Debit spreads are
    // directional (premium_collected null) and excluded by the is_credit filter.
    const pipelinePositions = [
      ...(positions.open_csps ?? []),
      ...(positions.assigned_shares ?? []).filter((s) => s.active_cc).map((s) => s.active_cc),
      ...(positions.open_spreads ?? []).filter((s) => s.is_credit),
    ];
    const openPremiumGross = Math.round(pipelinePositions.reduce((s, p) => s + (p.premium_collected || 0), 0));
    const mtd              = accountSnap.month_to_date_premium ?? 0;

    // v2 pipeline forecast — same engine the dashboard and the EOD-cron snapshot
    // use, so intraday pipeline numbers match instead of falling back to the
    // legacy flat-60% lump sum. Non-blocking: a v2 failure null-fills the v2
    // fields and the legacy flat-60% fields still populate.
    let forecastV2 = null;
    try {
      ({ forecastV2 } = await computeForecastV2({ supabase, today, vix, positions: positionRows }));
    } catch (v2Err) {
      console.error("[api/eod-snapshot] v2 forecast failed (non-blocking):", v2Err);
    }

    const allLeaps = [
      ...(positions.open_leaps ?? []),
      ...(positions.assigned_shares ?? []).flatMap((s) => s.open_leaps ?? []),
    ];

    // Per-ticker allocations — pulled directly from the published Google Sheet
    // which tracks current position values (shares, CSP collateral, LEAPs).
    const accountValue = accountSnap.account_value ?? 0;
    const tickerAllocations =
      sheetAllocResult.status === "fulfilled" && sheetAllocResult.value
        ? sheetAllocResult.value
        : {};

    effectiveSnapshot = {
      account_value:              accountValue,
      free_cash:                  accountSnap.free_cash_est,
      free_cash_pct:              cashPct,
      cash_floor_target_pct:      band?.floorPct    ?? null,
      cash_ceiling_target_pct:    band?.ceilingPct  ?? null,
      within_band:    band && cashPct != null ? cashPct >= band.floorPct && cashPct <= band.ceilingPct : null,
      overdeployed:   band && cashPct != null ? cashPct < band.floorPct  : null,
      underdeployed:  band && cashPct != null ? cashPct > band.ceilingPct : null,
      mtd_premium_collected:      mtd,
      ...pipelineSnapshotFields({ forecastV2, openPremiumGross }),
      vix,
      vix_band:                   band?.sentiment ?? null,
      open_csp_count:             (positions.open_csps ?? []).length,
      open_cc_count:              (positions.assigned_shares ?? []).filter((s) => s.active_cc).length,
      open_leaps_count:           allLeaps.length,
      assigned_share_tickers:     (positions.assigned_shares ?? []).length,
      ticker_allocations:         Object.keys(tickerAllocations).length ? tickerAllocations : null,
      _source:                    "live",
    };
  } else if (effectiveSnapshot) {
    effectiveSnapshot = { ...effectiveSnapshot, _source: "daily_snapshot" };
  }

  // ── Decision framing for active assigned positions ────────────────────────
  // Reuse the CSP baseline computed for the existing cut-and-redeploy benchmark.
  // For each active assigned ticker, rebuild the lifespan and compute framing.
  const assignedTickers = (positions?.assigned_shares ?? []).map((s) => s.ticker);
  const decisionFraming = [];
  const recoveryMissingIv = [];

  // Recovery-gauge inputs, keyed by ticker. IV source priority (per spec):
  //   cushion_iv_used on any open CSP for the ticker → else radar iv → else null.
  const cushionIvByTicker = {};
  for (const csp of positions?.open_csps ?? []) {
    if (csp.cushion_iv_used != null && cushionIvByTicker[csp.ticker] == null) {
      cushionIvByTicker[csp.ticker] = csp.cushion_iv_used;
    }
  }
  const ccDteByTicker = {};
  for (const s of positions?.assigned_shares ?? []) {
    if (s.active_cc?.days_to_expiry != null) ccDteByTicker[s.ticker] = s.active_cc.days_to_expiry;
  }

  if (assignedTickers.length > 0) {
    // Fetch CSP baseline (same query/columns as position-lifespan)
    const cspBaselineResult = await supabase
      .from("trades")
      .select("id, premium_collected, capital_fronted, days_held, close_date, subtype, strike, contracts, spot_at_assignment")
      .eq("type", "CSP")
      .in("subtype", ["Close", "Roll Loss", "Assigned"])
      .gt("days_held", 0)
      .gt("capital_fronted", 0)
      .order("close_date", { ascending: false })
      .limit(60);

    const cspBaseline = computeCspBaseline(cspBaselineResult.data ?? []);
    const tradesByTicker = await fetchTickerTrades(supabase, assignedTickers);

    // Try to read prices from quotesMap (already populated from radar quotes).
    // For tickers not in the radar universe, fetch their quotes separately.
    const missingPriceTickers = assignedTickers.filter((tk) => !quotesMap[tk]);
    let extraPrices = {};
    if (missingPriceTickers.length > 0) {
      const { data: extraQuotes, error: extraError } = await supabase
        .from("quotes")
        .select("symbol, last")
        .in("symbol", missingPriceTickers);
      if (!extraError) {
        for (const q of extraQuotes ?? []) {
          if (q?.symbol && q.last != null) extraPrices[q.symbol] = parseFloat(q.last);
        }
      }
    }

    for (const tk of assignedTickers) {
      const tickerTrades = tradesByTicker[tk] ?? [];
      const lifespans = detectLifespans(tk, tickerTrades);
      const activeLifespan = lifespans.find((l) => !l.exit_event);
      if (!activeLifespan) continue;

      const built = buildLifespan(activeLifespan, cspBaseline, today);
      const currentSpot = quotesMap[tk]?.last ?? extraPrices[tk] ?? null;

      const cushionIv = cushionIvByTicker[tk] ?? null;
      const radarIv   = quotesMap[tk]?.iv != null ? parseFloat(quotesMap[tk].iv) : null;
      const iv        = cushionIv ?? radarIv ?? null;
      const ivSource  = cushionIv != null ? "cushion" : (radarIv != null ? "radar" : null);

      const framing = computeDecisionFraming({
        lifespan: built,
        currentSpot,
        baselineRate: cspBaseline.avg_return_per_capital_day,
        ticker: tk,
        today,
        iv,
        ivSource,
        ccDte: ccDteByTicker[tk] ?? null,
      });
      if (framing) {
        decisionFraming.push({ ticker: tk, ...framing });
        if (framing.recovery?.iv_used == null) recoveryMissingIv.push(tk);
      }
    }
  }

  // Sort by drawdown severity then ticker alphabetical
  const drawdownSeverityRank = { severe: 0, deep: 1, moderate: 2, shallow: 3 };
  decisionFraming.sort((a, b) => {
    const dr = drawdownSeverityRank[a.drawdown_zone] - drawdownSeverityRank[b.drawdown_zone];
    if (dr !== 0) return dr;
    return a.ticker.localeCompare(b.ticker);
  });

  // ── Risk units (descriptive-only) ──
  let risk = null, riskText = "";
  try {
    const out = await buildSnapshotRisk(supabase, positions, {
      todayIso: today,
      accountValue: effectiveSnapshot?.account_value ?? null,
    });
    risk = out.risk;
    riskText = out.text;
  } catch (err) {
    console.warn("[api/eod-snapshot] risk block failed:", err.message);
  }

  const text = buildTextBlob({
    today,
    dailySnapshot: effectiveSnapshot,
    positions,
    journalEntries,
    macroAiContext,
    macroPosture,
    spyQuote,
    qqqQuote,
    radarRows,
    decisionFraming,
  });

  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.status(200).json({
    ok:    true,
    date:  today,
    time:  nowStr,
    text: riskText ? `${text}\n${riskText}\n` : text,
    data_completeness: {
      cushion_missing_iv:      cushionMissingIv,
      recovery_missing_iv:     recoveryMissingIv,
      cushion_skipped_spreads: [],
    },
    data: {
      account_summary: effectiveSnapshot,
      positions,
      journal_entries: journalEntries,
      risk,
      macro: { ai_context: macroAiContext, posture: macroPosture },
      market: { spy: spyQuote, qqq: qqqQuote, vix: liveVix },
      radar: radarRows,
      decision_framing: decisionFraming,
    },
  });
}
