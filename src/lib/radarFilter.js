// Pure row predicate for the Radar advanced filters. Extracted from RadarTab so
// it can be unit-tested in isolation. Component-local lookups (ownership,
// earnings-days, IV-trend) are injected via `ctx`; everything else is computed
// here from the row + the shared entryScore/rsi libs.
//
// Covers ALL advanced-filter dimensions. The separate BB-bucket pill filter
// (`bbFilter`) stays in RadarTab and is applied before this.

import { compositeIv, getTrendState, entryScore, scoreLabel } from "./entryScore.js";
import { rsiBucket } from "./rsi.js";

/**
 * @param {object} row     a merged Radar row (quotes + fundamentals + uw_signals)
 * @param {object} filters advancedFilters (DEFAULT_FILTERS shape)
 * @param {object} ctx     { isHeld, earningsDaysAway, ivTrend, includeSectors, excludeSectors }
 * @returns {boolean}
 */
export function rowMatchesFilters(row, filters, ctx) {
  const f = filters;

  // ── Numeric ranges (moved unchanged from RadarTab) ──
  if (f.bb_position_min  !== null && row.bb_position < f.bb_position_min)  return false;
  if (f.bb_position_max  !== null && row.bb_position > f.bb_position_max)  return false;
  if (f.raw_iv_min       !== null && row.iv          < f.raw_iv_min)       return false;
  if (f.raw_iv_max       !== null && row.iv          > f.raw_iv_max)       return false;
  const civ = compositeIv(row.iv, row.iv_rank);
  if (f.composite_iv_min !== null && civ             < f.composite_iv_min) return false;
  if (f.composite_iv_max !== null && civ             > f.composite_iv_max) return false;
  if (f.iv_rank_min      !== null && row.iv_rank     < f.iv_rank_min)      return false;
  if (f.iv_rank_max      !== null && row.iv_rank     > f.iv_rank_max)      return false;
  if (f.pe_min !== null && row.pe_ttm != null && row.pe_ttm < f.pe_min)    return false;
  if (f.pe_max !== null && row.pe_ttm != null && row.pe_ttm > f.pe_max)    return false;

  // ── Sectors (pre-expanded in ctx) ──
  if (ctx.includeSectors.length > 0) {
    if (!ctx.includeSectors.includes(row.sector)) return false;
  } else if (ctx.excludeSectors.length > 0) {
    if (ctx.excludeSectors.includes(row.sector)) return false;
  }

  // ── Ownership ──
  const isHeld = ctx.isHeld(row.ticker);
  if (f.ownership === "not_held" && isHeld)  return false;
  if (f.ownership === "held"     && !isHeld) return false;

  // ── Earnings (null days = unknown = passes, unchanged) ──
  if (f.earnings_days_min !== null) {
    const days = ctx.earningsDaysAway(row.ticker);
    if (days !== null && days < f.earnings_days_min) return false;
  }

  // ── Chip-signal allow-sets (empty = skip; null value under active filter = exclude) ──
  const ivTrend = ctx.ivTrend(row.ticker);

  if (f.trend_states?.length) {
    const t = getTrendState(row.last, row.ma_50, row.ma_200)?.state ?? null;
    if (!t || !f.trend_states.includes(t)) return false;
  }
  if (f.rsi_buckets?.length) {
    const b = rsiBucket(row.rsi_14);
    if (!b || !f.rsi_buckets.includes(b)) return false;
  }
  if (f.score_buckets?.length) {
    const s = scoreLabel(entryScore(
      row.bb_position, row.iv, row.iv_rank, row.last, row.ma_50, row.ma_200,
      ivTrend, row.gamma_env, row.flow_tape_ema,
    ));
    if (!s || !f.score_buckets.includes(s)) return false;
  }
  if (f.gex_envs?.length) {
    if (!row.gex_env || !f.gex_envs.includes(row.gex_env)) return false;
  }
  if (f.iv_trend_states?.length) {
    const st = ivTrend?.state ?? null;
    if (!st || !f.iv_trend_states.includes(st)) return false;
  }

  return true;
}
