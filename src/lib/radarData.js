// Shared Radar data layer — the single source of truth for "what is a Radar row".
//
// Extracted from src/hooks/useRadar.js so that both the browser (useRadar) and
// the server (api/agent-scan.js) build rows from the same queries and the same
// merge. Previously the queries lived inside the hook; any server-side consumer
// had to restate them, and would have drifted the moment a column moved — as
// happened in a093ed4 when Radar's IV/price source became the UW screener.
//
// Takes a Supabase client rather than importing one, so the caller decides
// between the browser anon client and the server service-role client.

export const RADAR_QUOTE_COLUMNS = [
  "symbol", "last", "prev_close", "iv", "iv_rank",
  "bb_position", "bb_upper", "bb_lower", "bb_sma20", "bb_refreshed_at",
  "earnings_date", "earnings_meta", "earnings_refreshed_at",
  "ma_50", "ma_200", "rsi_14",
].join(", ");

export const RADAR_FUNDAMENTAL_COLUMNS = "ticker, pe_ttm, pe_annual, eps_ttm, beta";

export const RADAR_UW_COLUMNS = [
  "ticker", "gamma_env", "flow_sentiment", "flow_ema", "flow_streak",
  "flow_tape_ema", "gex_env", "gex_support", "gex_resistance", "gex_air_pocket",
].join(", ");

/**
 * Merge the four Radar source tables into the flat row shape RadarTab,
 * AIThesisTab, radarFilter and entryScore all consume.
 *
 * Pure — no I/O — so it can be unit-tested with fixtures.
 */
export function mergeRadarRows({ universe, quotes, fundamentals, uwSignals }) {
  const quotesMap = {};
  for (const q of (quotes || [])) quotesMap[q.symbol] = q;
  const fundMap = {};
  for (const f of (fundamentals || [])) fundMap[f.ticker] = f;
  const uwMap = {};
  for (const u of (uwSignals || [])) uwMap[u.ticker] = u;

  return (universe || []).map((u) => {
    const q  = quotesMap[u.ticker] || {};
    const f  = fundMap[u.ticker]   || {};
    const uw = uwMap[u.ticker]     || {};
    return {
      ticker:                u.ticker,
      company:               u.company,
      sector:                u.sector,
      price_category:        u.price_category,
      last:                  q.last            ?? null,
      prev_close:            q.prev_close      ?? null,
      iv:                    q.iv              ?? null,
      iv_rank:               q.iv_rank         ?? null,
      bb_position:           q.bb_position     ?? null,
      bb_upper:              q.bb_upper        ?? null,
      bb_lower:              q.bb_lower        ?? null,
      bb_sma20:              q.bb_sma20        ?? null,
      bb_refreshed_at:       q.bb_refreshed_at ?? null,
      earnings_date:         q.earnings_date   ?? null,
      earnings_meta:         q.earnings_meta   ?? null,
      earnings_refreshed_at: q.earnings_refreshed_at ?? null,
      ma_50:                 q.ma_50           ?? null,
      ma_200:                q.ma_200          ?? null,
      rsi_14:                q.rsi_14          ?? null,
      pe_ttm:                f.pe_ttm          ?? null,
      pe_annual:             f.pe_annual       ?? null,
      eps_ttm:               f.eps_ttm         ?? null,
      beta:                  f.beta            ?? null,
      gamma_env:             uw.gamma_env      ?? null,
      flow_sentiment:        uw.flow_sentiment ?? null,
      flow_ema:              uw.flow_ema       ?? null,
      flow_streak:           uw.flow_streak    ?? null,
      flow_tape_ema:         uw.flow_tape_ema  ?? null,
      gex_env:               uw.gex_env        ?? null,
      gex_support:           uw.gex_support    ?? null,
      gex_resistance:        uw.gex_resistance ?? null,
      gex_air_pocket:        uw.gex_air_pocket ?? null,
    };
  });
}

/**
 * Fetch + merge the approved wheel universe into Radar rows.
 *
 * Failure policy is inherited from useRadar: universe and quotes are hard
 * requirements (throw), fundamentals and uw_signals are optional (warn, and
 * their score modifiers degrade to no-ops).
 *
 * @returns {{ rows: object[], bbRefreshedAt: string|null }}
 */
export async function fetchRadarRows(supabase) {
  const { data: universe, error: universeErr } = await supabase
    .from("wheel_universe")
    .select("ticker, company, sector, price_category")
    .eq("list_type", "approved")
    .order("ticker");

  if (universeErr) throw universeErr;

  const approvedTickers = (universe || []).map((u) => u.ticker);

  const [
    { data: quotes,       error: quotesErr },
    { data: fundamentals, error: fundErr   },
    { data: uwSignals,    error: uwErr     },
  ] = await Promise.all([
    supabase.from("quotes").select(RADAR_QUOTE_COLUMNS).in("symbol", approvedTickers),
    supabase.from("fundamentals").select(RADAR_FUNDAMENTAL_COLUMNS).in("ticker", approvedTickers),
    supabase.from("uw_signals").select(RADAR_UW_COLUMNS).in("ticker", approvedTickers),
  ]);

  if (quotesErr) throw quotesErr;
  if (fundErr) console.warn("[fetchRadarRows] fundamentals fetch failed:", fundErr.message);
  // UW signals are optional — null/empty just means the score modifiers stay no-ops.
  if (uwErr) console.warn("[fetchRadarRows] uw_signals fetch failed:", uwErr.message);

  const rows = mergeRadarRows({ universe, quotes, fundamentals, uwSignals });

  // Newest bb_refreshed_at across the universe — the "BB data as of" stamp.
  const bbRefreshedAt = rows
    .map(r => r.bb_refreshed_at)
    .filter(Boolean)
    .sort()
    .pop() ?? null;

  return { rows, bbRefreshedAt };
}

/**
 * Days until a ticker's next earnings, from the market_context payload.
 * Moved out of RadarTab so the server can build the same filter ctx.
 * Returns null when market_context has no entry for the ticker — callers
 * (and rowMatchesFilters) treat null as "unknown", not "fails the filter".
 */
export function getEarningsDaysAway(ticker, marketContext) {
  if (!marketContext?.positions) return null;
  const ctx = marketContext.positions.find(p => p.ticker === ticker);
  if (!ctx?.nextEarnings?.date) return null;
  return Math.ceil((new Date(ctx.nextEarnings.date) - new Date()) / (1000 * 60 * 60 * 24));
}
