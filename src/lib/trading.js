import { getVixBand } from "./vixBand";

export function normalizeTrade(t) {
  const fmtDate = (iso) => (iso ? iso.slice(5).replace("-", "/") : "—");
  const closeDate = t.close_date ? new Date(t.close_date + "T12:00:00") : null;
  const keptStr =
    t.kept_pct != null ? `${Math.round(t.kept_pct * 100)}%` : "—";
  return {
    id: t.id ?? null,
    ticker: t.ticker,
    type: t.type,
    subtype: t.subtype,
    strike: t.strike ?? null,
    contracts: t.contracts ?? null,
    open: fmtDate(t.open_date),
    close: fmtDate(t.close_date),
    expiry: fmtDate(t.expiry_date),  // option expiration date (separate from close)
    closeDate,               // Date object — used by calendar
    days: t.days_held ?? null,
    premium: t.premium_collected ?? 0,
    kept: keptStr,
    fronted: t.capital_fronted ?? null,
    expiry_date: t.expiry_date ?? null,
    open_date:   t.open_date   ?? null,
    description: t.description ?? null,
    source: t.source ?? "",
    notes: t.notes ?? "",
  };
}

export function calcDTE(expiryISO) {
  if (!expiryISO) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryISO + "T00:00:00");
  return Math.max(0, Math.ceil((expiry - today) / (1000 * 60 * 60 * 24)));
}

export function isMarketHours() {
  const et  = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day  = et.getDay();
  const time = et.getHours() + et.getMinutes() / 60;
  return day >= 1 && day <= 5 && time >= 9.5 && time <= 16;
}

// Builds the metadata JSONB snapshot stored on every EOD journal entry.
// Pure function — all inputs passed in, no side effects.
export function computeEodMetadata({ freeCashPct, vix, pipelineTotal, mtdRealized, activity, cspSnapshot }) {
  const band    = getVixBand(vix);
  const ceiling = band?.ceilingPct ?? null;
  const floor   = band?.floorPct   ?? null;
  const cashFrac = (freeCashPct != null && freeCashPct !== "") ? freeCashPct / 100 : null;
  const floorStatus =
    cashFrac == null || ceiling == null ? null
    : cashFrac > ceiling ? "above"
    : cashFrac < floor   ? "below"
    : "within";
  const floorDelta =
    floorStatus === "above" ? +(cashFrac - ceiling).toFixed(3)
    : floorStatus === "below" ? +(floor - cashFrac).toFixed(3)
    : null;
  return {
    free_cash_pct:   freeCashPct != null && freeCashPct !== "" ? +freeCashPct : null,
    vix:             vix         != null && vix         !== "" ? +vix         : null,
    mtd_realized:    mtdRealized  ?? null,
    pipeline_total:  pipelineTotal != null && pipelineTotal !== "" ? +pipelineTotal : null,
    pipeline_est:    pipelineTotal != null && pipelineTotal !== "" ? Math.round(+pipelineTotal * 0.60) : null,
    floor_band_low:  floor   != null ? Math.round(floor   * 100) : null,
    floor_band_high: ceiling != null ? Math.round(ceiling * 100) : null,
    floor_status:    floorStatus,
    floor_delta:     floorDelta,
    activity:        activity    ?? { closed: [], opened: [] },
    csp_snapshot:    cspSnapshot ?? [],
  };
}

export function calcPipeline(positions, captureRate) {
  const openPositions = [
    ...positions.open_csps,
    ...positions.assigned_shares
      .filter(s => s.active_cc)
      .map(s => s.active_cc),
  ];
  const grossOpenPremium = openPositions.reduce((sum, p) => sum + (p.premium_collected || 0), 0);
  const expectedPipeline = Math.round(grossOpenPremium * captureRate);
  return { grossOpenPremium, expectedPipeline, hasPositions: openPositions.length > 0 };
}

export function allocColor(pct) {
  if (pct >= 0.15) return "#f85149";  // red — at hard ceiling
  if (pct >= 0.10) return "#e3b341";  // amber — approaching limit
  return "#8b949e";                    // gray — normal
}
