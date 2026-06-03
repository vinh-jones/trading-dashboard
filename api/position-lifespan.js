/**
 * api/position-lifespan.js — Vercel serverless function
 *
 * GET /api/position-lifespan
 *   → summary list of all lifespans across all tickers
 *
 * GET /api/position-lifespan?ticker={TICKER}
 *   → summary list of all lifespans for that ticker
 *
 * GET /api/position-lifespan?ticker={TICKER}&assignment_id={DATE}
 *   → full single lifespan (DATE = first assignment event date for the lifespan)
 */

import { createClient } from "@supabase/supabase-js";
import {
  detectLifespans,
  buildLifespan,
  computeCspBaseline,
  computeDecisionFraming,
  lifespanSummary,
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

// Fetch last-trade prices from the cached quotes table.
// Returns { ticker: lastPrice }. Missing tickers are absent from the map.
// Returns { [symbol]: { last, iv } } for the given tickers. `iv` feeds the
// recovery gauge (radar/equity IV — no cushion enrichment in this endpoint).
async function fetchLastPrices(supabase, tickers) {
  if (!tickers || tickers.length === 0) return {};
  const { data, error } = await supabase
    .from("quotes")
    .select("symbol, last, iv")
    .in("symbol", tickers);
  if (error) {
    console.warn("[api/position-lifespan] quotes fetch failed:", error.message);
    return {};
  }
  const map = {};
  for (const q of data ?? []) {
    if (q?.symbol && q.last != null) {
      map[q.symbol] = {
        last: parseFloat(q.last),
        iv:   q.iv != null ? parseFloat(q.iv) : null,
      };
    }
  }
  return map;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { ticker, assignment_id } = req.query;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const supabase = getSupabase();

    const cspBaselineResult = await supabase
      .from("trades")
      .select("id, premium_collected, capital_fronted, days_held, close_date, subtype, strike, contracts, spot_at_assignment")
      .eq("type", "CSP")
      .in("subtype", ["Close", "Roll Loss", "Assigned"])
      .gt("days_held", 0)
      .gt("capital_fronted", 0)
      .order("close_date", { ascending: false })
      .limit(60);

    if (cspBaselineResult.error)
      throw new Error(`csp_baseline: ${cspBaselineResult.error.message}`);

    const cspBaseline = computeCspBaseline(cspBaselineResult.data ?? []);

    // --- No ticker: summaries for all tickers ---
    if (!ticker) {
      const allTradesResult = await supabase
        .from("trades")
        .select("*")
        .order("close_date", { ascending: true });

      if (allTradesResult.error)
        throw new Error(`trades: ${allTradesResult.error.message}`);

      const tradesByTicker = {};
      for (const t of allTradesResult.data ?? []) {
        if (!tradesByTicker[t.ticker]) tradesByTicker[t.ticker] = [];
        tradesByTicker[t.ticker].push(t);
      }

      const built = [];
      for (const [tk, tickerTrades] of Object.entries(tradesByTicker)) {
        for (const raw of detectLifespans(tk, tickerTrades)) {
          built.push({ ticker: tk, lifespan: buildLifespan(raw, cspBaseline, today) });
        }
      }

      // Fetch quotes once for all active-lifespan tickers
      const activeTickers = [...new Set(
        built.filter(({ lifespan }) => lifespan.lifespan_status === "active").map((b) => b.ticker)
      )];
      const prices = await fetchLastPrices(supabase, activeTickers);

      const allSummaries = built.map(({ ticker: tk, lifespan }) => {
        const summary = lifespanSummary(lifespan);
        if (lifespan.lifespan_status === "active") {
          const framing = computeDecisionFraming({
            lifespan,
            currentSpot: prices[tk]?.last ?? null,
            baselineRate: cspBaseline.avg_return_per_capital_day,
            ticker: tk,
            today,
            iv: prices[tk]?.iv ?? null,
            ivSource: prices[tk]?.iv != null ? "radar" : null,
          });
          if (framing) summary.decision_framing = framing;
        }
        return summary;
      });
      allSummaries.sort((a, b) =>
        (b.assignment_date ?? "").localeCompare(a.assignment_date ?? "")
      );

      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json({
        ok: true,
        lifespan_count: allSummaries.length,
        lifespans: allSummaries,
      });
    }

    // --- Ticker-scoped ---
    const tickerUpper = ticker.toUpperCase();

    const tickerTradesResult = await supabase
      .from("trades")
      .select("*")
      .eq("ticker", tickerUpper)
      .order("close_date", { ascending: true });

    if (tickerTradesResult.error)
      throw new Error(`trades: ${tickerTradesResult.error.message}`);

    const rawLifespans = detectLifespans(tickerUpper, tickerTradesResult.data ?? []);

    if (rawLifespans.length === 0) {
      return res.status(404).json({
        ok: false,
        error:
          `No assigned-share lifespans found for ticker ${tickerUpper}. ` +
          `Only CSP-to-assignment positions are tracked here; ` +
          `CSP-only or LEAPS positions are not included.`,
      });
    }

    if (assignment_id) {
      // --- Single lifespan mode ---
      const raw = rawLifespans.find(
        (l) => l.assignment_events[0]?.date === assignment_id
      );
      if (!raw) {
        const available = rawLifespans
          .map((l) => l.assignment_events[0]?.date)
          .filter(Boolean);
        return res.status(404).json({
          ok: false,
          error:
            `No lifespan found for ${tickerUpper} starting on ${assignment_id}. ` +
            `Available lifespan start dates: ${available.join(", ")}`,
        });
      }

      const lifespan = buildLifespan(raw, cspBaseline, today);

      // Compute decision_framing for active lifespans (no-op for closed)
      let decisionFraming = null;
      if (lifespan.lifespan_status === "active") {
        const prices = await fetchLastPrices(supabase, [tickerUpper]);
        decisionFraming = computeDecisionFraming({
          lifespan,
          currentSpot: prices[tickerUpper]?.last ?? null,
          baselineRate: cspBaseline.avg_return_per_capital_day,
          ticker: tickerUpper,
          today,
          iv: prices[tickerUpper]?.iv ?? null,
          ivSource: prices[tickerUpper]?.iv != null ? "radar" : null,
        });
      }

      let linkedJournals = [];
      if (lifespan._tradeIds.length > 0) {
        const journalResult = await supabase
          .from("journal_entries")
          .select("id, entry_date, entry_type, title, body, trade_id")
          .in("trade_id", lifespan._tradeIds);
        if (!journalResult.error) linkedJournals = journalResult.data ?? [];
      }

      const result = attachJournalContext(lifespan, linkedJournals);
      if (decisionFraming) result.decision_framing = decisionFraming;

      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json({ ok: true, ...result });
    } else {
      // --- List mode: all lifespans for ticker ---
      const built = rawLifespans.map((r) => buildLifespan(r, cspBaseline, today));

      // For active lifespans, fetch a single quote and inject decision_framing
      // onto the summary (only). Closed lifespans don't get the field.
      const hasActive = built.some((l) => l.lifespan_status === "active");
      const prices = hasActive ? await fetchLastPrices(supabase, [tickerUpper]) : {};

      const summaries = built.map((l) => {
        const summary = lifespanSummary(l);
        if (l.lifespan_status === "active") {
          const framing = computeDecisionFraming({
            lifespan: l,
            currentSpot: prices[tickerUpper]?.last ?? null,
            baselineRate: cspBaseline.avg_return_per_capital_day,
            ticker: tickerUpper,
            today,
            iv: prices[tickerUpper]?.iv ?? null,
            ivSource: prices[tickerUpper]?.iv != null ? "radar" : null,
          });
          if (framing) summary.decision_framing = framing;
        }
        return summary;
      });

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
// Journal attachment (single lifespan detail mode only)
// ---------------------------------------------------------------------------

function attachJournalContext(lifespan, linkedJournals) {
  const byTradeId = {};
  for (const j of linkedJournals) {
    if (j.trade_id && !byTradeId[j.trade_id]) byTradeId[j.trade_id] = j;
  }
  const cc_history = lifespan.cc_history.map((cc) => ({
    ...cc,
    journal_context_summary: byTradeId[cc.trade_id]?.body?.slice(0, 200) ?? null,
  }));
  const { _tradeIds, ...rest } = lifespan;
  return { ...rest, cc_history };
}
