/**
 * api/_lib/macroSnapshotRow.js — buildMacroPayload() output → a macro_snapshots row.
 *
 * Pure: no I/O, no clock. api/snapshot.js does the upsert.
 *
 * Workstream A of the 2026-08-19 macro-persistence spec. The posture composite is
 * computed at request time and, until v1.181.0, was never durably recorded — which
 * is why a macro counterfactual could not be run over any prior entry. This is the
 * shape that gets recorded.
 */

// Stamped on every row so a later reader can tell which signal set and which
// scoring rules produced a given composite. Bump it when either changes.
export const MACRO_SPEC_VERSION = "macro-persistence-v1";

// Signal-set size the composite is scored against. Stored per row (not assumed)
// so a future change stays legible in the data rather than only in git history.
export const SIGNAL_COUNT = 7;

const round = (v, dp) => (Number.isFinite(v) ? Math.round(v * 10 ** dp) / 10 ** dp : null);
const num = (v) => (Number.isFinite(v) ? v : null);

/**
 * @param {object} macroData  the object returned by buildMacroPayload()
 * @param {string} snapshotDate  YYYY-MM-DD
 * @returns {object} a row ready to upsert into macro_snapshots
 */
export function buildMacroSnapshotRow(macroData, snapshotDate) {
  const s = macroData?.signals ?? {};
  const posture = macroData?.posture ?? {};

  const vix     = s.vix          ?? {};
  const s5fi    = s.s5fi         ?? {};
  const fg      = s.fearGreed    ?? {};
  const fed     = s.fedWatch     ?? {};
  const spy     = s.spyVsAth     ?? {};
  const oil     = s.crudeOil     ?? {};
  const tenY    = s.tenYearYield ?? {};

  return {
    snapshot_date: snapshotDate,

    // ── raw values, one per signal ──
    vix:                  num(vix.value),
    vix_change:           num(vix.change),
    // The 5-session move is the "trend" line the Macro tab renders. It is absent
    // (not zero) when the VIX history fetch fails.
    vix_5d_change:        num(vix.vixTrend?.changePts),
    s5fi_pct:             num(s5fi.value),
    fear_greed_score:     num(fg.value),
    fed_cuts_priced_in:   num(fed.cutsPricedIn),
    fed_implied_eoy_rate: num(fed.endOfYearImplied),
    fed_current_rate:     num(fed.currentRate),
    spy_pct_from_ath:     num(spy.pctFromHigh),
    wti_crude:            num(oil.price),
    wti_crude_change:     num(oil.change),
    ust10y:               num(tenY.yield),
    // UW/Yahoo report the 10-year change in percentage points; bps is what the
    // rate desk reads, so convert once here rather than in every later query.
    ust10y_change_bps:    round(num(tenY.change) * 100, 1),

    // ── per-signal attribution ──
    // null, never a fallback number: an unavailable signal must not be
    // indistinguishable from a genuine neutral reading. Keys are fixed so a query
    // can select signal_scores->>'oil' across the whole history.
    signal_scores: {
      vix:        num(vix.score),
      s5fi:       num(s5fi.score),
      fear_greed: num(fg.score),
      fed:        num(fed.score),
      spy_ath:    num(spy.score),
      oil:        num(oil.score),
      rates:      num(tenY.score),
    },

    // ── composite ──
    posture:             posture.posture ?? null,
    posture_score:       num(posture.avg),
    deployment_guidance: posture.deploymentGuidance ?? null,

    // Without these two, a posture_score is ambiguous forever — 3.2 could be a
    // genuine middling read or a read with two dead feeds. Analysis comparing
    // composites across dates MUST filter signals_available = signals_total.
    signals_available: num(posture.signalsAvailable),
    signals_total:     num(posture.signalsTotal) ?? SIGNAL_COUNT,

    ai_context:   macroData?.ai_context ?? null,
    spec_version: MACRO_SPEC_VERSION,
    source:       "live",
  };
}
