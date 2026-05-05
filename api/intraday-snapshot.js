/**
 * api/intraday-snapshot.js — Vercel serverless function
 *
 * GET /api/intraday-snapshot
 *
 * Lighter, intraday companion to /api/eod-snapshot. Optimized for mid-session
 * decision questions — same copy-paste workflow, shaped for "what should I act
 * on right now" rather than EOD review.
 *
 * Sections:
 *   1. Account header (value, cash %, deployment status, VIX, posture label)
 *   2. Open positions with per-position action flags
 *   3. Today's closed transactions
 *   4. Macro signals (posture + ai_context)
 *   5. Radar universe
 *
 * Per-position flags (computed server-side):
 *   - earnings_before_expiry : earnings date falls between today and expiry
 *   - cc_breach_risk         : underlying within 5% below CC strike
 *   - near_60_60             : ≥55% profit AND ≥55% DTE remaining
 *   - dte_warning            : 0 or 1 DTE
 *
 * Earnings data sourced from quotes.earnings_date (populated daily by
 * ingest-wheel-earnings via Finnhub).
 */

import { createClient } from "@supabase/supabase-js";
import { reshapePositions } from "./_lib/reshapePositions.js";
import { buildOccSymbol } from "./_lib/occ.js";
import { getVixBand } from "../src/lib/vixBand.js";
import { computeCushion } from "../src/lib/cushionBreach.js";

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
  const changePct =
    Math.round(((last - prevClose) / prevClose) * 10000) / 100;
  return { last, prevClose, change, changePct };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function fmt$(n, decimals = 0) {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (n < 0 ? "-$" : "$") + formatted;
}

function fmtChange(change, changePct) {
  if (change == null) return "";
  const sign = change >= 0 ? "+" : "";
  return `${sign}$${Math.abs(change).toFixed(2)} (${sign}${changePct?.toFixed(2)}%)`;
}

function pad(s, w) {
  return String(s ?? "").padEnd(w);
}

function calDaysDiff(fromIso, toIso) {
  const a = new Date(fromIso + "T12:00:00");
  const b = new Date(toIso + "T12:00:00");
  return Math.round((b - a) / 86400000);
}

// ─── Flag computation ────────────────────────────────────────────────

function posKey(ticker, expiryDate, strike) {
  return `${ticker}_${expiryDate}_${strike}`;
}

function computeOptionFlags(pos, quoteMap, earningsMap, today) {
  const flags = {
    earnings_before_expiry: false,
    earnings_date: null,
    cc_breach_risk: false,
    near_60_60: false,
    dte_warning: false,
    profit_pct: null,
  };

  const dte = pos.days_to_expiry ?? null;

  if (dte != null && dte <= 1) flags.dte_warning = true;

  const earningsDate = earningsMap[pos.ticker] ?? null;
  if (earningsDate && pos.expiry_date) {
    if (earningsDate > today && earningsDate <= pos.expiry_date) {
      flags.earnings_before_expiry = true;
      flags.earnings_date = earningsDate;
    }
  }

  if (
    pos.expiry_date &&
    pos.open_date &&
    pos.contracts &&
    pos.premium_collected &&
    dte != null
  ) {
    const isCall = pos.type === "CC";
    const occSym = buildOccSymbol(
      pos.ticker,
      pos.expiry_date,
      isCall,
      pos.strike
    );
    const currentMid = quoteMap.get(occSym)?.mid ?? null;
    const entryPerShare =
      pos.entry_cost ?? pos.premium_collected / (pos.contracts * 100);

    if (currentMid != null && entryPerShare > 0) {
      const profitPct = 1 - currentMid / entryPerShare;
      flags.profit_pct = profitPct;

      const originalDte = calDaysDiff(pos.open_date, pos.expiry_date);
      const dtePctRemaining = originalDte > 0 ? dte / originalDte : 0;
      if (profitPct >= 0.55 && dtePctRemaining >= 0.55) {
        flags.near_60_60 = true;
      }
    }
  }

  return flags;
}

function computeCCBreachRisk(cc, quoteMap) {
  const q = quoteMap.get(cc.ticker);
  const underlying = q?.mid ?? q?.last ?? null;
  if (underlying == null || cc.strike == null) return false;
  return underlying >= cc.strike * 0.95;
}

function enrichCspCushion(openCsps, quoteMap) {
  const missingIv = [];
  const enriched  = openCsps.map(p => {
    const q          = quoteMap.get(p.ticker);
    const underlying = q?.mid ?? q?.last ?? null;
    const iv         = q?.iv ?? null;
    if (iv == null) missingIv.push(p.ticker);
    return { ...p, ...computeCushion(p.strike, underlying, iv) };
  });
  return { enriched, missingIv };
}

// ─── Text blob ───────────────────────────────────────────────────────

function flagTags(flags, isCC = false) {
  const parts = [];
  if (flags.dte_warning) parts.push("[⚠ DTE_WARNING]");
  if (flags.near_60_60) parts.push("[⚠ NEAR_60_60]");
  if (isCC && flags.cc_breach_risk) parts.push("[⚠ CC_BREACH]");
  if (flags.earnings_before_expiry)
    parts.push(`[⚠ EARNINGS ${flags.earnings_date}]`);
  return parts.length ? "  " + parts.join(" ") : "";
}

function buildTextBlob({
  today,
  nowStr,
  effectiveSnapshot,
  positions,
  flagsMap,
  todayTrades,
  macroAiContext,
  macroPosture,
  spyQuote,
  qqqQuote,
  radarRows,
}) {
  const lines = [];

  const dateStr = new Date(today + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  lines.push(`INTRADAY SNAPSHOT — ${dateStr}  ${nowStr}`);
  lines.push("═".repeat(60));
  lines.push("");

  // ── Account ──
  if (effectiveSnapshot) {
    const ds = effectiveSnapshot;
    lines.push("ACCOUNT");
    lines.push("─".repeat(40));

    const cashPct =
      ds.free_cash_pct != null
        ? (ds.free_cash_pct * 100).toFixed(1) + "%"
        : "—";
    let bandStatus = "";
    if (ds.within_band) bandStatus = "✓ in band";
    else if (ds.overdeployed) bandStatus = "↑ above ceiling";
    else if (ds.underdeployed) bandStatus = "↓ below floor";

    const floorPct =
      ds.cash_floor_target_pct != null
        ? (ds.cash_floor_target_pct * 100).toFixed(0) + "%"
        : null;
    const ceilPct =
      ds.cash_ceiling_target_pct != null
        ? (ds.cash_ceiling_target_pct * 100).toFixed(0) + "%"
        : null;
    const bandRange =
      floorPct && ceilPct ? `Floor: ${floorPct}–${ceilPct}` : "";

    lines.push(`Account Value: ${fmt$(ds.account_value)}`);
    lines.push(
      `Free Cash: ${cashPct} ${bandStatus}${bandRange ? "  (" + bandRange + ")" : ""}`
    );
    if (ds.vix != null) lines.push(`VIX: ${ds.vix} · ${ds.vix_band ?? ""}`);
    if (macroPosture) lines.push(`Macro Posture: ${macroPosture.posture}`);
    lines.push("");
  }

  // ── Market ──
  lines.push("MARKET");
  lines.push("─".repeat(40));
  if (spyQuote)
    lines.push(
      `SPY: $${spyQuote.last.toFixed(2)} ${fmtChange(spyQuote.change, spyQuote.changePct)}`
    );
  if (qqqQuote)
    lines.push(
      `QQQ: $${qqqQuote.last.toFixed(2)} ${fmtChange(qqqQuote.change, qqqQuote.changePct)}`
    );
  lines.push("");

  // ── Open CSPs ──
  const csps = positions?.open_csps ?? [];
  if (csps.length) {
    lines.push(`OPEN CSPs (${csps.length})`);
    lines.push("─".repeat(40));
    for (const p of csps) {
      const flags = flagsMap[posKey(p.ticker, p.expiry_date, p.strike)] ?? {};
      const profitStr =
        flags.profit_pct != null
          ? `${(flags.profit_pct * 100).toFixed(0)}% profit`
          : "—% profit";
      const ror = p.roi != null ? `  ${(p.roi * 100).toFixed(2)}% RoR` : "";
      const cushionTag = p.cushion_state === "assignment_risk" ? "  [● ASSIGNMENT RISK]"
        : p.cushion_state === "approaching" ? "  [⚠ APPROACHING]"
        : "";
      lines.push(
        `${pad(p.ticker, 6)} $${p.strike}p  exp ${p.expiry_date} (${p.days_to_expiry}d)  ${profitStr}  ${fmt$(p.premium_collected)} premium  ${fmt$(p.capital_fronted)} capital${ror}${flagTags(flags)}${cushionTag}`
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
      lines.push(`${s.ticker}  Shares · Cost basis: ${fmt$(s.cost_basis_total)}`);
      if (s.active_cc) {
        const cc = s.active_cc;
        const flags =
          flagsMap[posKey(cc.ticker, cc.expiry_date, cc.strike)] ?? {};
        const profitStr =
          flags.profit_pct != null
            ? `${(flags.profit_pct * 100).toFixed(0)}% profit`
            : "—% profit";
        const ror = cc.roi != null ? `  ${(cc.roi * 100).toFixed(2)}% RoR` : "";
        lines.push(
          `  ↳ CC $${cc.strike}c  exp ${cc.expiry_date} (${cc.days_to_expiry}d)  ${profitStr}  ${fmt$(cc.premium_collected)} premium${ror}${flagTags(flags, true)}`
        );
      } else {
        lines.push(`  ↳ No active CC`);
      }
    }
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
      const flags =
        flagsMap[posKey(l.ticker, l.expiry_date ?? "", l.strike ?? "LEAPS")] ??
        {};
      const earningsTag = flags.earnings_before_expiry
        ? `  [⚠ EARNINGS ${flags.earnings_date}]`
        : "";
      const dteTag = flags.dte_warning ? "  [⚠ DTE_WARNING]" : "";
      lines.push(
        `${pad(l.ticker, 6)} ${l.description ?? l.subtype ?? ""} · ${fmt$(l.capital_fronted)} capital · exp ${l.expiry_date ?? "—"}${dteTag}${earningsTag}`
      );
    }
    lines.push("");
  }

  // ── Today's Closed ──
  if (todayTrades.length) {
    lines.push(`TODAY'S CLOSED (${todayTrades.length})`);
    lines.push("─".repeat(40));
    for (const t of todayTrades) {
      const profitStr =
        t.kept_pct != null
          ? `${(t.kept_pct * 100).toFixed(0)}% profit captured`
          : "—% profit captured";
      const strikeStr = t.strike
        ? ` $${t.strike}${t.type === "CC" ? "c" : "p"}`
        : "";
      lines.push(
        `${pad(t.ticker, 6)} ${t.type}${strikeStr}  exp ${t.expiry_date ?? "—"}  ${profitStr}  ${fmt$(t.premium_collected)} premium`
      );
    }
    lines.push("");
  }

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

  // ── Radar Universe ──
  if (radarRows.length) {
    lines.push(`RADAR UNIVERSE (${radarRows.length} tickers)`);
    lines.push("─".repeat(40));
    lines.push("TICKER  LAST     IV     IV_RANK  BB_POSITION");
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

// ─── Main handler ────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const nowStr =
    now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Los_Angeles",
    }) + " PT";

  const supabase = getSupabase();

  const [
    positionsResult,
    universeResult,
    accountSnapshotResult,
    allQuotesResult,
    todayTradesResult,
    macroResult,
  ] = await Promise.allSettled([
    supabase.from("positions").select("*").order("ticker"),
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
    supabase
      .from("quotes")
      .select(
        "symbol, last, mid, iv, iv_rank, bb_position, earnings_date, instrument_type"
      ),
    supabase
      .from("trades")
      .select(
        "ticker, type, subtype, strike, expiry_date, premium_collected, kept_pct"
      )
      .eq("close_date", today)
      .order("id", { ascending: false }),
    supabase
      .from("macro_snapshots")
      .select("ai_context, posture, posture_score")
      .eq("snapshot_date", today)
      .single(),
  ]);

  const positionRows =
    positionsResult.status === "fulfilled"
      ? positionsResult.value.data ?? []
      : [];
  let positions = reshapePositions(positionRows);

  const universeRows =
    universeResult.status === "fulfilled"
      ? universeResult.value.data ?? []
      : [];

  const accountSnap =
    accountSnapshotResult.status === "fulfilled"
      ? accountSnapshotResult.value.data ?? null
      : null;

  const allQuotes =
    allQuotesResult.status === "fulfilled"
      ? allQuotesResult.value.data ?? []
      : [];
  const quoteMap = new Map(allQuotes.map((q) => [q.symbol, q]));

  // Earnings: ticker → nearest upcoming date (from equity rows only)
  const earningsMap = {};
  for (const q of allQuotes) {
    if (q.earnings_date && q.instrument_type === "EQUITY") {
      earningsMap[q.symbol] = q.earnings_date;
    }
  }

  const todayTrades =
    todayTradesResult.status === "fulfilled"
      ? todayTradesResult.value.data ?? []
      : [];

  // ── Per-position flags ──
  const flagsMap = {};

  for (const p of positions.open_csps ?? []) {
    const flags = computeOptionFlags(p, quoteMap, earningsMap, today);
    flagsMap[posKey(p.ticker, p.expiry_date, p.strike)] = flags;
  }

  for (const s of positions.assigned_shares ?? []) {
    if (s.active_cc) {
      const cc = s.active_cc;
      const flags = computeOptionFlags(cc, quoteMap, earningsMap, today);
      flags.cc_breach_risk = computeCCBreachRisk(cc, quoteMap);
      flagsMap[posKey(cc.ticker, cc.expiry_date, cc.strike)] = flags;
    }
    for (const l of s.open_leaps ?? []) {
      const k = posKey(l.ticker, l.expiry_date ?? "", l.strike ?? "LEAPS");
      const earningsDate = earningsMap[l.ticker] ?? null;
      flagsMap[k] = {
        earnings_before_expiry:
          !!(
            earningsDate &&
            l.expiry_date &&
            earningsDate > today &&
            earningsDate <= l.expiry_date
          ),
        earnings_date:
          earningsDate && l.expiry_date && earningsDate > today && earningsDate <= l.expiry_date
            ? earningsDate
            : null,
        dte_warning: false,
        profit_pct: null,
      };
    }
  }

  for (const l of positions.open_leaps ?? []) {
    const k = posKey(l.ticker, l.expiry_date ?? "", l.strike ?? "LEAPS");
    const earningsDate = earningsMap[l.ticker] ?? null;
    flagsMap[k] = {
      earnings_before_expiry:
        !!(
          earningsDate &&
          l.expiry_date &&
          earningsDate > today &&
          earningsDate <= l.expiry_date
        ),
      earnings_date:
        earningsDate && l.expiry_date && earningsDate > today && earningsDate <= l.expiry_date
          ? earningsDate
          : null,
      dte_warning: false,
      profit_pct: null,
    };
  }

  // ── Cushion enrichment for CSPs ──
  let cushionMissingIv = [];
  const enrichResult = enrichCspCushion(positions.open_csps ?? [], quoteMap);
  positions        = { ...positions, open_csps: enrichResult.enriched };
  cushionMissingIv = enrichResult.missingIv;

  // ── Market + macro ──
  const [spyResult, qqqResult, vixResult] = await Promise.allSettled([
    fetchYahooQuote("SPY"),
    fetchYahooQuote("QQQ"),
    fetchYahooQuote("^VIX"),
  ]);

  const spyQuote = spyResult.status === "fulfilled" ? spyResult.value : null;
  const qqqQuote = qqqResult.status === "fulfilled" ? qqqResult.value : null;
  const liveVix = vixResult.status === "fulfilled" ? vixResult.value.last : null;

  let macroAiContext = null;
  let macroPosture = null;
  const cachedMacro =
    macroResult.status === "fulfilled" ? macroResult.value.data : null;

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
        headers: { "User-Agent": "internal-intraday-snapshot" },
      });
      const macroData = await macroRes.json();
      if (macroData.ok) {
        macroAiContext = macroData.ai_context ?? null;
        macroPosture = macroData.posture ?? null;
      }
    } catch (err) {
      console.warn("[api/intraday-snapshot] macro fetch failed:", err.message);
    }
  }

  // ── Account snapshot (always live — daily_snapshot won't exist intraday) ──
  let effectiveSnapshot = null;
  if (accountSnap) {
    const vix = liveVix ?? accountSnap.vix_current ?? null;
    const band = getVixBand(vix);
    const cashPct = accountSnap.free_cash_pct_est ?? null;

    effectiveSnapshot = {
      account_value: accountSnap.account_value,
      free_cash_pct: cashPct,
      cash_floor_target_pct: band?.floorPct ?? null,
      cash_ceiling_target_pct: band?.ceilingPct ?? null,
      within_band:
        band && cashPct != null
          ? cashPct >= band.floorPct && cashPct <= band.ceilingPct
          : null,
      overdeployed:
        band && cashPct != null ? cashPct < band.floorPct : null,
      underdeployed:
        band && cashPct != null ? cashPct > band.ceilingPct : null,
      vix,
      vix_band: band?.sentiment ?? null,
    };
  }

  // ── Radar rows ──
  const quotesLookup = {};
  for (const q of allQuotes) quotesLookup[q.symbol] = q;
  const radarRows = universeRows.map((u) => {
    const q = quotesLookup[u.ticker] ?? {};
    return {
      ticker: u.ticker,
      company: u.company,
      sector: u.sector,
      last: q.last ?? null,
      iv: q.iv ?? null,
      iv_rank: q.iv_rank ?? null,
      bb_position: q.bb_position ?? null,
    };
  });

  const text = buildTextBlob({
    today,
    nowStr,
    effectiveSnapshot,
    positions,
    flagsMap,
    todayTrades,
    macroAiContext,
    macroPosture,
    spyQuote,
    qqqQuote,
    radarRows,
  });

  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.status(200).json({
    ok: true,
    date: today,
    time: nowStr,
    text,
    data: {
      account_summary: effectiveSnapshot,
      positions,
      position_flags: flagsMap,
      today_trades: todayTrades,
      macro: { ai_context: macroAiContext, posture: macroPosture },
      market: { spy: spyQuote, qqq: qqqQuote, vix: liveVix },
      radar: radarRows,
    },
    data_completeness: {
      cushion_missing_iv:      cushionMissingIv,
      cushion_skipped_spreads: [],
    },
  });
}
