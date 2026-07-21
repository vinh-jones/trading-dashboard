/**
 * api/agent-scan.js — Vercel serverless function
 *
 * GET /api/agent-scan
 *
 * A machine-readable snapshot of the two screens an AI assistant needs to help
 * pick wheel candidates: the **Radar** table (per-ticker entry signals, with
 * curated presets applied server-side) and the **AI Thesis** basket grid.
 *
 * Both screens render off the same `useRadar()` rows in the browser, so this
 * serves both from one query with one consistent as-of stamp.
 *
 * Query params:
 *   ?preset=prime-setup     apply a curated preset (accepts bare id or the
 *                           full `builtin:prime-setup` form). Omit for the
 *                           unfiltered approved universe.
 *   ?exposure=true          include dollar exposure per basket/ticker.
 *                           OFF BY DEFAULT — the default payload carries
 *                           signals and a held/not-held flag but no position
 *                           sizes, so a leaked response is not a book.
 *   ?limit=N                cap the candidate list (default: no cap).
 *   ?refresh=true           re-run the full ingest chain before reading.
 *                           OFF BY DEFAULT — see the warning below.
 *
 * FRESHNESS: this route is a READ. It serves whatever the ingest crons last
 * wrote and reports the age in `freshness` (bbAgeMinutes / marketOpen / stale),
 * so a consumer can tell fresh data from stale rather than assuming.
 *
 * ?refresh=true is a deliberate escape hatch, NOT a default, because the ingest
 * routes it calls are batch jobs: bb / uw-snapshot / uw-gex each loop
 * sequentially over the ~50-ticker universe issuing per-ticker external API
 * calls (300+ round trips, plus a rate-limit sleep). They carry maxDuration
 * 60–120 and run as twice-daily crons for that reason. Chaining them inline
 * makes a request take MINUTES, which shipped as the default in v1.171.0 and
 * broke every client with a sane HTTP timeout. If you pass it, use a client
 * timeout of 5+ minutes and expect metered UW calls.
 *
 * For a scheduled consumer: don't. During the session /api/quotes runs every
 * 15 minutes, so a plain read is already current; use `freshness.stale` to
 * detect a dead ingest instead of pre-emptively forcing one.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (or APP_SECRET / app_auth
 * cookie) — same helper the uw-*.js endpoints use.
 *
 * PARITY CONTRACT: every number here is computed by the same shared modules the
 * dashboard renders from — entryScore, radarFilter, curatedPresets, ivTrend,
 * radarData. Nothing is restated locally. buildScanPayload() is pure so
 * api/__tests__/agent-scan.test.js can assert it against the client filter path
 * on shared fixtures.
 */

import { createClient } from "@supabase/supabase-js";

import { fetchRadarRows, getEarningsDaysAway } from "../src/lib/radarData.js";
import { fetchIvTrends } from "../src/lib/ivTrend.js";
import { rowMatchesFilters } from "../src/lib/radarFilter.js";
import { compositeIv, getTrendState, entryScore, scoreLabel } from "../src/lib/entryScore.js";
import { rsiBucket } from "../src/lib/rsi.js";
import { bbBucket } from "../src/lib/bbBucket.js";
import { CURATED_PRESETS } from "../src/components/radar/curatedPresets.js";
import { DEFAULT_FILTERS, expandGroupsToSectors } from "../src/components/radar/radarConstants.js";
import { AI_BASKETS } from "../src/config/aiBaskets.js";
import { isTickerHeld, getAssignedShares, getOpenCSPs, getOpenLEAPs } from "../src/lib/positionSchema.js";
import { tickerExposure } from "../src/lib/exposure.js";
import { reshapePositions } from "./_lib/reshapePositions.js";
import { runRefreshChain } from "./_lib/refreshChain.js";
import { isMarketOpen } from "./_marketHours.js";

// Bump when the payload shape or a signal definition changes, so a polling
// agent can detect that its cached understanding is stale.
export const METHODOLOGY_VERSION = "1.0.0";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  // market_context is RLS-locked (no anon policy) — must use the service role
  // server-side. Anon fallback is for local dev only.
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

// Same shape as the uw-*.js endpoints: a cron/agent carries
// `Authorization: Bearer ${CRON_SECRET}`; a logged-in manual trigger from the
// dashboard carries the app_auth cookie (or Bearer APP_SECRET).
function authorized(req) {
  const auth   = req.headers["authorization"] || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const cron   = process.env.CRON_SECRET;
  const app    = process.env.APP_SECRET;
  if (cron && bearer === cron) return true;
  if (app && bearer === app) return true;
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)app_auth=([^;]+)/);
  const cookieTok = m ? decodeURIComponent(m[1]) : null;
  return !!(app && cookieTok === app);
}

/**
 * Refresh is opt-in: ONLY the exact string "true" turns it on.
 *
 * v1.171.0 had this inverted (on unless ?refresh=false) which made every plain
 * call chain five batch ingest jobs and take minutes — any client with a normal
 * timeout saw a hang. Default-deny is the safe polarity here: a missing,
 * malformed, or unexpected value must land on the cheap read, never the
 * multi-minute one.
 */
export function wantsRefresh(query) {
  return String(query?.refresh ?? "") === "true";
}

/** Accepts "prime-setup" or "builtin:prime-setup". */
export function resolveCuratedPreset(presetParam) {
  if (!presetParam) return null;
  const wanted = presetParam.startsWith("builtin:") ? presetParam : `builtin:${presetParam}`;
  return CURATED_PRESETS.find(p => p.id === wanted) ?? null;
}

/**
 * Field legend shipped with every response. Without this a fresh agent has no
 * way to know that LOW bb is the favourable direction, or that iv is a decimal
 * while ivRank is 0–100 — it would read the table backwards.
 */
export const FIELD_LEGEND = {
  score:      "Scanner score, 0–1. base = (1 − bb)·0.50 + compositeIv·0.50, then × trend × ivTrend × gammaEnv × flow. Higher = better CSP entry.",
  scoreLabel: "Strong ≥0.70 · Moderate ≥0.50 · Neutral ≥0.30 · Weak <0.30.",
  bb:         "Bollinger Band position within the 20-day band. 0 = lower band, 1 = upper band, <0 = below. LOWER IS BETTER for a CSP entry.",
  bbBucket:   "below_band <0 · near_lower 0–0.20 · mid_range 0.20–0.80 · near_upper 0.80–1.0 · above_band >1.0.",
  rsi:        "RSI(14). Context only — deliberately NOT part of the scanner score (it would double-count Bollinger position).",
  iv:         "Raw implied volatility, decimal (0.85 = 85%).",
  ivRank:     "IV rank vs this name's own trailing 52 weeks, 0–100. Higher = premium rich relative to its own history.",
  compositeIv:"(ivRank/100)·0.60 + min(iv/1.50, 1)·0.40 — the richness half of the score.",
  ivTrend:    "5-day IV-rank direction; gated on raw IV also moving. rising 1.10 · stable 1.00 · falling/collapsing 0.90 · spiking 0.85.",
  trend:      "Price vs 50/200-day MA. uptrend 1.00 · pullback 0.90 · recovering 0.85 · downtrend 0.70.",
  gexEnv:     "Dealer gamma environment from Unusual Whales. 'stabilized' = dealers dampen moves (CSP-friendly).",
  earningsDaysAway: "Calendar days to next earnings; null = unknown (not the same as 'far away').",
  held:       "Ticker already carries open exposure in the book (assigned shares, open CSP, or top-level LEAP).",
};

export const CAVEATS = [
  "This is a CONFIRMATION screen, not a deploy trigger. Presets are named for what matched, never for what to do.",
  "Per-ticker filters cannot see household concentration — a clean Prime Setup list can be five names in the same AI-infra cluster, which is one bet, not five.",
  "Sizing is governed by the VIX cash target, not by this list.",
];

/**
 * Pure composition: rows + context → response payload (minus `asOf.generatedAt`).
 * Kept free of I/O so the parity test can drive it with fixtures.
 */
export function buildScanPayload({
  rows,
  ivTrendsByTicker = new Map(),
  positions = null,
  marketContext = null,
  preset = null,
  wantExposure = false,
  limit = null,
  bbRefreshedAt = null,
  refresh = null,
  marketOpen = null,
}) {
  const filters = preset ? { ...DEFAULT_FILTERS, ...preset.filters } : { ...DEFAULT_FILTERS };
  // Identical ctx construction to RadarTab's.
  const ctx = {
    isHeld:           (ticker) => isTickerHeld(positions, ticker),
    earningsDaysAway: (ticker) => getEarningsDaysAway(ticker, marketContext),
    ivTrend:          (ticker) => ivTrendsByTicker.get(ticker) ?? null,
    includeSectors:   expandGroupsToSectors(filters.sectors_include),
    excludeSectors:   expandGroupsToSectors(filters.sectors_exclude),
  };

  const matched = rows.filter(row => rowMatchesFilters(row, filters, ctx));

  const shaped = matched.map((r) => {
    const ivTrend = ivTrendsByTicker.get(r.ticker) ?? null;
    const trend   = getTrendState(r.last, r.ma_50, r.ma_200);
    const score   = entryScore(
      r.bb_position, r.iv, r.iv_rank, r.last, r.ma_50, r.ma_200,
      ivTrend, r.gamma_env, r.flow_tape_ema,
    );
    return {
      ticker:      r.ticker,
      company:     r.company,
      sector:      r.sector,
      price:       r.last,
      score:       score != null ? Math.round(score * 1000) / 1000 : null,
      scoreLabel:  scoreLabel(score),
      bb:          r.bb_position,
      bbBucket:    bbBucket(r.bb_position),
      rsi:         r.rsi_14,
      rsiBucket:   rsiBucket(r.rsi_14),
      iv:          r.iv,
      ivRank:      r.iv_rank,
      compositeIv: compositeIv(r.iv, r.iv_rank),
      ivTrend:     ivTrend ? { state: ivTrend.state, label: ivTrend.label, modifier: ivTrend.modifier ?? null } : null,
      trend:       trend ? { state: trend.state, modifier: trend.modifier } : null,
      gexEnv:      r.gex_env,
      gammaEnv:    r.gamma_env,
      flowTapeEma: r.flow_tape_ema,
      pe:          r.pe_ttm,
      beta:        r.beta,
      earningsDate:     r.earnings_date,
      earningsDaysAway: getEarningsDaysAway(r.ticker, marketContext),
      held:        isTickerHeld(positions, r.ticker),
    };
  });

  // Default sort matches the Radar screen: Scanner Score, descending.
  shaped.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  const candidates = limit != null && limit > 0 ? shaped.slice(0, limit) : shaped;

  // ── Baskets (AI Thesis grid) ──
  const rowByTicker = new Map(rows.map(r => [r.ticker, r]));
  const includeExposure = wantExposure && positions != null;

  const baskets = AI_BASKETS.map((basket) => {
    const members = basket.tickers.map((ticker) => {
      const r = rowByTicker.get(ticker);
      const dayPct = (r?.last != null && r?.prev_close)
        ? Math.round(((r.last - r.prev_close) / r.prev_close) * 1000) / 10
        : null;
      const member = {
        ticker,
        dayPct,
        ivRank: r?.iv_rank ?? null,
        bb:     r?.bb_position ?? null,
        held:   isTickerHeld(positions, ticker),
      };
      if (includeExposure) {
        member.exposure = tickerExposure(
          getAssignedShares(positions).find(s => s.ticker === ticker),
          getOpenCSPs(positions).filter(p => p.ticker === ticker),
          getOpenLEAPs(positions).filter(l => l.ticker === ticker),
        );
      }
      return member;
    });

    const bbs   = members.map(m => m.bb).filter(v => v != null);
    const bbAvg = bbs.length ? Math.round((bbs.reduce((a, b) => a + b, 0) / bbs.length) * 100) / 100 : null;

    const out = {
      id:       basket.id,
      name:     basket.name,
      display:  basket.display,
      bbAvg,
      bbBucket: bbBucket(bbAvg),
      tickers:  members,
    };
    if (includeExposure) {
      out.exposure = members.reduce((sum, m) => sum + (m.exposure ?? 0), 0);
    }
    return out;
  });

  // Freshness is reported even when a refresh ran — it is how you tell a
  // successful refresh from one that returned 200 without writing anything.
  const bbAgeMinutes = bbRefreshedAt
    ? Math.round((Date.now() - new Date(bbRefreshedAt).getTime()) / 60000)
    : null;

  return {
    ok: true,
    asOf: {
      bbRefreshedAt,
      marketContextAsOf: marketContext?.asOf ?? null,
    },
    freshness: {
      bbAgeMinutes,
      marketOpen,
      // Cron cadence is 15m during the session, so anything older than ~20m
      // while the market is open means an ingest is not landing.
      stale: bbAgeMinutes == null ? true : (marketOpen === true && bbAgeMinutes > 20),
    },
    refresh,
    methodology: {
      version:   METHODOLOGY_VERSION,
      explainer: "docs/radar-explainer-for-ai.md",
      fields:    FIELD_LEGEND,
      caveats:   CAVEATS,
    },
    // VIX is not duplicated here — GET /api/vix is the live source, and
    // restating it would create a second refresh path to drift.
    vixSource: "/api/vix",
    preset: preset
      ? { id: preset.id.replace(/^builtin:/, ""), name: preset.name, filters: preset.filters }
      : null,
    availablePresets: CURATED_PRESETS.map(p => ({ id: p.id.replace(/^builtin:/, ""), name: p.name })),
    counts: {
      universe:   rows.length,
      candidates: shaped.length,
      returned:   candidates.length,
    },
    exposureIncluded: includeExposure,
    candidates,
    baskets,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  if (!authorized(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const presetParam  = req.query?.preset ?? null;
  const wantExposure = String(req.query?.exposure ?? "") === "true";
  const limit        = req.query?.limit ? parseInt(req.query.limit, 10) : null;
  const wantRefresh  = wantsRefresh(req.query);

  const preset = resolveCuratedPreset(presetParam);
  if (presetParam && !preset) {
    res.status(400).json({
      ok: false,
      error: `Unknown preset "${presetParam}"`,
      available: CURATED_PRESETS.map(p => ({ id: p.id.replace(/^builtin:/, ""), name: p.name })),
    });
    return;
  }

  try {
    const supabase = getSupabase();

    // Opt-in only (?refresh=true). Chaining the ingest batch jobs inline costs
    // minutes, so the default path is a plain read plus honest `freshness`
    // reporting. Fails soft either way — a broken feed degrades freshness,
    // never availability.
    const refresh = wantRefresh
      ? await runRefreshChain({ secret: process.env.CRON_SECRET })
      : { ran: false, ms: 0, allOk: true, steps: [] };

    const { rows, bbRefreshedAt } = await fetchRadarRows(supabase);
    const tickers = rows.map(r => r.ticker);

    // Positions and market_context fail soft — without them `ownership` and
    // `earnings_days_min` degrade to "unknown", which the filter treats as a
    // pass rather than silently emptying the list.
    const [ivTrendsByTicker, positionsResult, contextResult] = await Promise.all([
      fetchIvTrends(supabase, tickers),
      supabase.from("positions").select("*").order("ticker"),
      supabase.from("market_context").select("*").order("as_of", { ascending: false }).limit(1).single(),
    ]);

    if (positionsResult.error) {
      console.warn("[agent-scan] positions fetch failed:", positionsResult.error.message);
    }
    // PGRST116 = no rows found — not an error for us.
    if (contextResult.error && contextResult.error.code !== "PGRST116") {
      console.warn("[agent-scan] market_context fetch failed:", contextResult.error.message);
    }

    const positions     = positionsResult.data ? reshapePositions(positionsResult.data) : null;
    const marketContext = contextResult.data
      ? { asOf: contextResult.data.as_of, positions: contextResult.data.positions }
      : null;

    const payload = buildScanPayload({
      rows, ivTrendsByTicker, positions, marketContext,
      preset, wantExposure, limit, bbRefreshedAt,
      refresh, marketOpen: isMarketOpen(),
    });
    payload.asOf.generatedAt = new Date().toISOString();

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(payload);
  } catch (err) {
    console.error("[agent-scan]", err);
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
}
