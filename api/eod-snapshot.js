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
import { getVixBand } from "../src/lib/vixBand.js";

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
      `MTD Realized: ${fmt$(ds.mtd_premium_collected)} | Pipeline Gross: ${fmt$(ds.open_premium_gross)} | Pipeline Est (60%): ${fmt$(ds.open_premium_expected)}`
    );
    lines.push(
      `Pipeline Implied Monthly: ${fmt$(ds.pipeline_implied_monthly)}`
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
      lines.push(
        `${pad(p.ticker, 6)} $${p.strike}p  exp ${p.expiry_date} (${p.days_to_expiry}d) · ${fmt$(p.premium_collected)} premium · ${fmt$(p.capital_fronted)} capital${ror ? "  " + ror : ""}`
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

// ─── Main handler ────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const today = new Date().toISOString().slice(0, 10);
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
  const positions = reshapePositions(positionRows);

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
  const [radarQuotesResult, spyResult, qqqResult, vixResult, macroResult] =
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

  const spyQuote = spyResult.status === "fulfilled" ? spyResult.value : null;
  const qqqQuote = qqqResult.status === "fulfilled" ? qqqResult.value : null;
  const liveVix  = vixResult.status === "fulfilled"  ? vixResult.value.last : null;

  // Build effective snapshot — prefer today's daily_snapshot (written by 4:30 PM ET cron),
  // but fall back to live data so Claude always has account context even intraday.
  const accountSnap =
    accountSnapshotResult.status === "fulfilled"
      ? accountSnapshotResult.value.data ?? null
      : null;

  let effectiveSnapshot = dailySnapshot;
  if (!effectiveSnapshot && accountSnap) {
    const vix     = liveVix ?? accountSnap.vix_current ?? null;
    const band    = getVixBand(vix);
    const cashPct = accountSnap.free_cash_pct_est ?? null;

    // Pipeline from live positions (CSPs + active CCs)
    const pipelinePositions = [
      ...(positions.open_csps ?? []),
      ...(positions.assigned_shares ?? []).filter((s) => s.active_cc).map((s) => s.active_cc),
    ];
    const openPremiumGross    = Math.round(pipelinePositions.reduce((s, p) => s + (p.premium_collected || 0), 0));
    const openPremiumExpected = Math.round(openPremiumGross * 0.60);
    const mtd                 = accountSnap.month_to_date_premium ?? 0;

    const allLeaps = [
      ...(positions.open_leaps ?? []),
      ...(positions.assigned_shares ?? []).flatMap((s) => s.open_leaps ?? []),
    ];

    effectiveSnapshot = {
      account_value:              accountSnap.account_value,
      free_cash:                  accountSnap.free_cash_est,
      free_cash_pct:              cashPct,
      cash_floor_target_pct:      band?.floorPct    ?? null,
      cash_ceiling_target_pct:    band?.ceilingPct  ?? null,
      within_band:    band && cashPct != null ? cashPct >= band.floorPct && cashPct <= band.ceilingPct : null,
      overdeployed:   band && cashPct != null ? cashPct < band.floorPct  : null,
      underdeployed:  band && cashPct != null ? cashPct > band.ceilingPct : null,
      mtd_premium_collected:      mtd,
      open_premium_gross:         openPremiumGross,
      open_premium_expected:      openPremiumExpected,
      pipeline_implied_monthly:   mtd + openPremiumExpected,
      vix,
      vix_band:                   band?.sentiment ?? null,
      open_csp_count:             (positions.open_csps ?? []).length,
      open_cc_count:              (positions.assigned_shares ?? []).filter((s) => s.active_cc).length,
      open_leaps_count:           allLeaps.length,
      assigned_share_tickers:     (positions.assigned_shares ?? []).length,
      ticker_allocations:         null,
      _source:                    "live",
    };
  } else if (effectiveSnapshot) {
    effectiveSnapshot = { ...effectiveSnapshot, _source: "daily_snapshot" };
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
  });

  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.status(200).json({
    ok:    true,
    date:  today,
    text,
    data: {
      account_summary: effectiveSnapshot,
      positions,
      journal_entries: journalEntries,
      macro: { ai_context: macroAiContext, posture: macroPosture },
      market: { spy: spyQuote, qqq: qqqQuote, vix: liveVix },
      radar: radarRows,
    },
  });
}
