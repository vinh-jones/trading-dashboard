// IV-trend classification — shared between the browser (useIvTrends) and the
// server (api/agent-scan.js).
//
// Extracted from src/hooks/useIvTrends.js so the scanner score can be computed
// identically on both sides. entryScore() takes ivTrend as a multiplier
// (rising 1.10 · stable 1.00 · falling/collapsing 0.90 · spiking 0.85), so an
// endpoint that skipped it would silently emit different scores than the UI
// shows for the same ticker.

// Minimum raw IV move (absolute, decimal scale) required to call something a
// real crush or spike. Without this, a 52-week high rolling off the window can
// produce a 30-pt IVR drop while actual implied vol is unchanged — which isn't
// a crush, it's just the ranking denominator shifting.
const RAW_IV_CRUSH_THRESHOLD = 0.08; // 8 percentage points (e.g. 0.90 → 0.82)

// Window drift thresholds — detects the *inverse* case the crush-gate above
// filters out: IVR moved a lot but raw IV barely moved at all. That's not a
// vol event, it's the 52-week high/low rolling off the lookback denominator.
// We flag it as context only — it does NOT alter the scanner score. See
// SPEC_IVR_DRIFT_DETECTION.md.
const IVR_DRIFT_CHANGE_THRESHOLD = 15;   // absolute IVR-point change over 5d
const IV_STABLE_THRESHOLD        = 0.03; // raw IV decimal — < 3pp = "stable"

// Lookback window for the trend read.
export const IV_TREND_LOOKBACK_DAYS = 5;

export function detectIvrWindowDrift(fiveDayChange, fiveDayIvChange) {
  if (fiveDayChange == null || fiveDayIvChange == null) return { detected: false };
  const ivrMoved = Math.abs(fiveDayChange)   >= IVR_DRIFT_CHANGE_THRESHOLD;
  const ivStable = Math.abs(fiveDayIvChange) <  IV_STABLE_THRESHOLD;
  if (!ivrMoved || !ivStable) return { detected: false };
  return {
    detected:      true,
    direction:     fiveDayChange < 0 ? "deflated" : "inflated",
    ivrChange:     Math.round(fiveDayChange * 10) / 10,
    ivChangeAbsPp: Math.round(Math.abs(fiveDayIvChange) * 1000) / 10, // pp
    daysAgo:       5,
  };
}

export function computeIvTrend(rows) {
  // rows sorted desc by captured_at (newest first)
  if (rows.length < 3) {
    return rows.length > 0 ? { state: "insufficient", dataPoints: rows.length } : null;
  }

  const current       = rows[0].iv_rank;
  const currentIv     = rows[0].iv;
  const oldest        = rows[rows.length - 1];
  const fiveDayChange = current - oldest.iv_rank;

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dayOldRow = rows.find(r => new Date(r.captured_at) <= oneDayAgo);
  const oneDayChange   = dayOldRow != null ? current - dayOldRow.iv_rank : null;
  const oneDayIvChange = (dayOldRow?.iv != null && currentIv != null)
    ? currentIv - dayOldRow.iv
    : null;

  // All trend labels require raw IV to have also moved meaningfully.
  // If IVR moved but raw IV didn't, the 52-week denominator shifted — not a
  // real vol event. Use the 5-day raw IV change for rising/falling (longer
  // window), and 1-day for spike/crush (acute event).
  const fiveDayIvChange = (currentIv != null && oldest.iv != null)
    ? currentIv - oldest.iv
    : null;
  const rawIvMovedToday   = oneDayIvChange  == null || Math.abs(oneDayIvChange)  >= RAW_IV_CRUSH_THRESHOLD;
  const rawIvMovedFiveDay = fiveDayIvChange == null || Math.abs(fiveDayIvChange) >= RAW_IV_CRUSH_THRESHOLD;
  const isSpike = oneDayChange != null && Math.abs(oneDayChange) >= 15 && rawIvMovedToday;

  const r1 = v => Math.round(v * 10) / 10;

  // Window drift is orthogonal to the trend state — it can coexist with
  // "stable" (the COHR case: IVR fell 35pts while raw IV sat flat) or with
  // rising/falling during partial artifacts. Attach it as a parallel field.
  const drift = detectIvrWindowDrift(fiveDayChange, fiveDayIvChange);

  const base = {
    fiveDayChange: r1(fiveDayChange),
    oneDayChange:  oneDayChange != null ? r1(oneDayChange) : null,
    dataPoints:    rows.length,
    drift,
  };

  if (isSpike && fiveDayChange > 0)              return { ...base, state: "spiking",    label: "IV Spike ↑",   modifier: 0.85 };
  if (isSpike && fiveDayChange < 0)              return { ...base, state: "collapsing", label: "IV Crush ↓",   modifier: 0.90 };
  if (fiveDayChange >= 8  && rawIvMovedFiveDay)  return { ...base, state: "rising",     label: "IV Rising ↑",  modifier: 1.10 };
  if (fiveDayChange <= -8 && rawIvMovedFiveDay)  return { ...base, state: "falling",    label: "IV Falling ↓", modifier: 0.90 };
  return                                                { ...base, state: "stable",     label: null,           modifier: 1.00 };
}

/**
 * Group raw iv_snapshots rows (newest-first) into a Map<ticker, ivTrend>.
 * Split out from the fetch so it can be unit-tested without a Supabase client.
 */
export function ivTrendsFromSnapshots(snapshotRows) {
  const byTicker = {};
  for (const row of (snapshotRows || [])) {
    if (!byTicker[row.ticker]) byTicker[row.ticker] = [];
    byTicker[row.ticker].push(row);
  }
  const map = new Map();
  for (const [ticker, rows] of Object.entries(byTicker)) {
    const trend = computeIvTrend(rows);
    if (trend) map.set(ticker, trend);
  }
  return map;
}

/**
 * Server-side counterpart to the useIvTrends hook. Takes any Supabase client
 * (browser anon or server service-role) and returns Map<ticker, ivTrend>.
 * Fails soft — a query error yields an empty map, which makes the IV-trend
 * score modifier a 1.0 no-op rather than breaking the whole scan.
 */
export async function fetchIvTrends(supabase, tickers) {
  if (!tickers || tickers.length === 0) return new Map();
  const since = new Date(Date.now() - IV_TREND_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("iv_snapshots")
    .select("ticker, iv, iv_rank, captured_at")
    .in("ticker", tickers)
    .gte("captured_at", since)
    .order("captured_at", { ascending: false });

  if (error) {
    console.warn("[fetchIvTrends] query failed:", error.message);
    return new Map();
  }
  return ivTrendsFromSnapshots(data);
}
