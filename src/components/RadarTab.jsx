import { useState, useMemo } from "react";
import { theme } from "../lib/theme";
import { useRadar } from "../hooks/useRadar";

// ── Score computation ─────────────────────────────────────────────────────────

function compositeIv(iv, ivRank) {
  if (iv == null || ivRank == null) return null;
  return (ivRank / 100 * 0.60) + (Math.min(iv / 1.50, 1.0) * 0.40);
}

function scannerScore(bbPosition, iv, ivRank) {
  if (bbPosition == null) return null;
  const ivComp = compositeIv(iv, ivRank);
  if (ivComp == null) return null;
  return (1 - bbPosition) * 0.50 + ivComp * 0.50;
}

function scoreLabel(score) {
  if (score == null) return null;
  if (score >= 0.70) return "Strong";
  if (score >= 0.50) return "Moderate";
  if (score >= 0.30) return "Neutral";
  return "Weak";
}

// ── BB bucket ─────────────────────────────────────────────────────────────────

function bbBucket(pos) {
  if (pos == null) return null;
  if (pos < 0)    return "below_band";
  if (pos < 0.20) return "near_lower";
  if (pos < 0.80) return "mid_range";
  if (pos <= 1.0) return "near_upper";
  return "above_band";
}

const BB_BUCKET_LABELS = {
  below_band: "Below Band",
  near_lower: "Near Lower",
  mid_range:  "Mid Range",
  near_upper: "Near Upper",
  above_band: "Above Band",
};

// Hardcoded hex — intentional exception (like TYPE_COLORS)
const BB_BUCKET_COLORS = {
  below_band: { bg: "#3d1a1a", text: "#f85149" },
  near_lower: { bg: "#1a3d1a", text: "#3fb950" },
  mid_range:  { bg: "#21262d", text: "#8b949e" },
  near_upper: { bg: "#3d3010", text: "#e3b341" },
  above_band: { bg: "#2d1f00", text: "#e3b341" },
};

// Row background — intentional exception
const SCORE_ROW_BG = {
  Strong:   "#0d1f0d",
  Weak:     "#1f0d0d",
};

// ── Position indicators ───────────────────────────────────────────────────────

function getPositionIndicators(ticker, positions) {
  const held = positions.filter(p => p.ticker === ticker);
  const indicators = [];
  if (held.some(p => p.position_type === "assigned_shares")) indicators.push("📌 Shares");
  if (held.some(p => p.type === "CSP"))   indicators.push("📋 CSP");
  if (held.some(p => p.type === "CC"))    indicators.push("🔼 CC");
  if (held.some(p => p.type === "LEAPS")) indicators.push("🔭 LEAPS");
  return indicators;
}

// ── Earnings warning ──────────────────────────────────────────────────────────

function getEarningsWarning(ticker, marketContext) {
  if (!marketContext?.positions) return null;
  const ctx = marketContext.positions.find(p => p.ticker === ticker);
  if (!ctx?.nextEarnings?.date) return null;
  const daysAway = Math.ceil((new Date(ctx.nextEarnings.date) - new Date()) / (1000 * 60 * 60 * 24));
  if (daysAway <= 21 && daysAway >= 0) return `⚠ Earnings ${ctx.nextEarnings.date}`;
  return null;
}

// ── Plain-English explanations ────────────────────────────────────────────────

const BB_EXPLANATIONS = {
  below_band: (ticker, bbPos) =>
    `${ticker} is trading below its lower Bollinger Band (position: ${bbPos.toFixed(2)}), ` +
    `meaning price has moved statistically far to the downside relative to its recent 20-day range. ` +
    `Historically this level acts as support. For CSP entry, this is a favorable price location — ` +
    `you're selling puts at a point of statistical stress, with mean reversion likely to work in your favor.`,

  near_lower: (ticker, bbPos) =>
    `${ticker} is approaching its lower Bollinger Band (position: ${bbPos.toFixed(2)}). ` +
    `Price is pulling back toward statistical support. ` +
    `A good entry zone for CSPs — you're getting favorable price placement without waiting for a full breakdown.`,

  mid_range: (ticker, bbPos) =>
    `${ticker} is trading in the middle of its Bollinger Band range (position: ${bbPos.toFixed(2)}). ` +
    `No strong directional signal from price alone. ` +
    `IV conditions matter more here — check the premium quality section below.`,

  near_upper: (ticker, bbPos) =>
    `${ticker} is approaching its upper Bollinger Band (position: ${bbPos.toFixed(2)}). ` +
    `Price is extended to the upside relative to recent history. ` +
    `Less favorable for new CSP entry — puts are further OTM and premium may be thinner. ` +
    `Better to wait for a pullback.`,

  above_band: (ticker, bbPos) =>
    `${ticker} is trading above its upper Bollinger Band (position: ${bbPos.toFixed(2)}). ` +
    `Price is statistically extended to the upside. ` +
    `Avoid new CSP entries here — you'd be selling puts far below a potentially unstable price level. ` +
    `Watch for a pullback toward the midline before entering.`,
};

const IV_EXPLANATIONS = {
  Strong: (ticker, ivPct, ivRank, composite) =>
    `IV rank of ${ivRank.toFixed(1)} puts ${ticker} in the elevated range — ` +
    `options are priced in the upper tier of their 52-week history. ` +
    `Raw IV of ${(ivPct * 100).toFixed(0)}% means premium is meaningful in absolute dollar terms. ` +
    `Strong conditions to sell premium. Composite score: ${composite.toFixed(2)}.`,

  Moderate: (ticker, ivPct, ivRank, composite) =>
    `IV rank of ${ivRank.toFixed(1)} puts ${ticker} around the midpoint of its historical range. ` +
    `You're getting reasonable premium but not at a historically elevated level. ` +
    `Raw IV of ${(ivPct * 100).toFixed(0)}% is ${ivPct > 0.60 ? "meaningful in absolute terms" : "moderate in absolute terms"}. ` +
    `Acceptable conditions to sell premium. Composite score: ${composite.toFixed(2)}.`,

  Weak: (ticker, ivPct, ivRank, composite) =>
    `IV rank of ${ivRank.toFixed(1)} puts ${ticker} near its cheapest options levels of the past year. ` +
    `Raw IV of ${(ivPct * 100).toFixed(0)}% means premium is thin. ` +
    `Consider waiting for a volatility event before selling puts on this name. ` +
    `Composite score: ${composite.toFixed(2)}.`,
};

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score }) {
  if (score == null) return null;
  const clamped = Math.max(0, Math.min(1, score));
  const filled = Math.round(clamped * 10);
  const label = scoreLabel(score);
  const barColor = label === "Strong" ? theme.green
    : label === "Moderate" ? theme.blue
    : label === "Neutral"  ? theme.text.muted
    : theme.red;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
      <div style={{ display: "flex", gap: 2 }}>
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            style={{
              width:        6,
              height:       14,
              borderRadius: 2,
              background:   i < filled ? barColor : theme.border.strong,
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: theme.size.xs, color: barColor, fontWeight: 600, minWidth: 52 }}>
        {label}
      </span>
    </div>
  );
}

// ── Compact row ───────────────────────────────────────────────────────────────

function RadarRow({ row, positions, marketContext, expanded, onToggle }) {
  const { ticker, company, sector, last, iv, iv_rank, bb_position, bb_upper, bb_lower, bb_sma20, bb_refreshed_at } = row;
  const bucket   = bbBucket(bb_position);
  const score    = scannerScore(bb_position, iv, iv_rank);
  const label    = scoreLabel(score);
  const bucketColors = bucket ? BB_BUCKET_COLORS[bucket] : null;
  const indicators   = getPositionIndicators(ticker, positions);
  const earningsWarn = getEarningsWarning(ticker, marketContext);

  const rowBg = label === "Strong" ? SCORE_ROW_BG.Strong
    : label === "Weak"   ? SCORE_ROW_BG.Weak
    : theme.bg.surface;

  return (
    <div>
      {/* Compact row */}
      <div
        onClick={onToggle}
        style={{
          display:       "flex",
          alignItems:    "center",
          gap:           theme.space[2],
          padding:       `${theme.space[2]}px ${theme.space[3]}px`,
          background:    expanded ? theme.bg.elevated : rowBg,
          borderBottom:  `1px solid ${theme.border.default}`,
          cursor:        "pointer",
          flexWrap:      "wrap",
          minHeight:     40,
          transition:    "background 0.1s",
        }}
      >
        {/* Ticker */}
        <span style={{
          fontSize:   theme.size.md,
          fontWeight: 700,
          color:      theme.text.primary,
          minWidth:   52,
          flexShrink: 0,
        }}>
          {ticker}
        </span>

        {/* Sector */}
        <span style={{
          fontSize:   theme.size.sm,
          color:      theme.text.muted,
          flexShrink: 0,
          minWidth:   80,
        }}>
          {sector ?? "—"}
        </span>

        {/* BB badge */}
        {bucket ? (
          <span style={{
            fontSize:     theme.size.xs,
            fontWeight:   600,
            color:        bucketColors.text,
            background:   bucketColors.bg,
            borderRadius: theme.radius.pill,
            padding:      "2px 8px",
            flexShrink:   0,
          }}>
            {BB_BUCKET_LABELS[bucket]}
          </span>
        ) : (
          <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, flexShrink: 0 }}>No BB data</span>
        )}

        {/* BB value */}
        {bb_position != null && (
          <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0 }}>
            BB: {bb_position.toFixed(2)}
          </span>
        )}

        {/* IV */}
        <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0 }}>
          {iv != null ? `IV: ${Math.round(iv * 100)}%` : "IV pending"}
        </span>

        {/* IVR */}
        {iv_rank != null && (
          <span style={{ fontSize: theme.size.sm, color: theme.text.muted, flexShrink: 0 }}>
            IVR: {iv_rank.toFixed(1)}
          </span>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Position indicators */}
        {indicators.length > 0 && (
          <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, flexShrink: 0 }}>
            {indicators.join(" · ")}
          </span>
        )}

        {/* Earnings warning */}
        {earningsWarn && (
          <span style={{ fontSize: theme.size.xs, color: theme.amber, fontWeight: 600, flexShrink: 0 }}>
            {earningsWarn}
          </span>
        )}

        {/* Score bar */}
        {score != null ? (
          <ScoreBar score={score} />
        ) : (
          <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>—</span>
        )}

        {/* Expand caret */}
        <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, flexShrink: 0, marginLeft: 4 }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <ExpandedPanel
          row={row}
          positions={positions}
          marketContext={marketContext}
          bucket={bucket}
          score={score}
        />
      )}
    </div>
  );
}

// ── Expanded detail panel ─────────────────────────────────────────────────────

function ExpandedPanel({ row, positions, marketContext, bucket, score }) {
  const { ticker, company, sector, price_category, last, iv, iv_rank, bb_position, bb_upper, bb_lower, bb_sma20 } = row;

  const ivComp    = compositeIv(iv, iv_rank);
  const label     = scoreLabel(score);
  const ivLabel   = scoreLabel(ivComp != null ? ivComp : null);
  const indicators = getPositionIndicators(ticker, positions);

  // Earnings info
  const earningsDate = marketContext?.positions?.find(p => p.ticker === ticker)?.nextEarnings?.date ?? null;
  const daysAway = earningsDate
    ? Math.ceil((new Date(earningsDate) - new Date()) / (1000 * 60 * 60 * 24))
    : null;

  const sectionLabelStyle = {
    fontSize:      theme.size.xs,
    fontWeight:    600,
    color:         theme.text.subtle,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom:  theme.space[2],
    marginTop:     theme.space[4],
  };

  const monoStyle = {
    fontFamily: theme.font.mono,
    fontSize:   theme.size.sm,
    color:      theme.text.secondary,
  };

  const fieldRow = (label, value, valueColor) => (
    <span style={{ ...monoStyle, color: valueColor ?? theme.text.secondary }}>
      <span style={{ color: theme.text.subtle }}>{label}: </span>
      {value ?? "—"}
    </span>
  );

  return (
    <div style={{
      background:   theme.bg.elevated,
      border:       `1px solid ${theme.border.default}`,
      borderTop:    "none",
      padding:      `${theme.space[3]}px ${theme.space[4]}px ${theme.space[4]}px`,
      marginBottom: 0,
    }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: theme.space[3], flexWrap: "wrap" }}>
        <span style={{ fontSize: theme.size.lg, fontWeight: 700, color: theme.text.primary }}>
          {ticker}
        </span>
        {company && (
          <span style={{ fontSize: theme.size.md, color: theme.text.secondary }}>
            — {company}
          </span>
        )}
        <span style={{ fontSize: theme.size.sm, color: theme.text.muted }}>
          {last != null ? `$${last.toFixed(2)}` : "price N/A"}
        </span>
        {sector && (
          <span style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>{sector}</span>
        )}
        {price_category && (
          <span style={{
            fontSize:     theme.size.xs,
            color:        theme.text.subtle,
            border:       `1px solid ${theme.border.strong}`,
            borderRadius: theme.radius.sm,
            padding:      "1px 5px",
          }}>
            {price_category}
          </span>
        )}
      </div>

      {/* ── Bollinger Band section ── */}
      <div style={sectionLabelStyle}>Bollinger Band Position</div>
      <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap", marginBottom: theme.space[2] }}>
        {fieldRow("BB Position", bb_position != null ? bb_position.toFixed(2) : null)}
        {bucket && (
          <span style={{ ...monoStyle }}>
            <span style={{ color: theme.text.subtle }}>Bucket: </span>
            <span style={{ color: BB_BUCKET_COLORS[bucket]?.text }}>{BB_BUCKET_LABELS[bucket]}</span>
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap", marginBottom: theme.space[3] }}>
        {fieldRow("SMA 20", bb_sma20 != null ? `$${bb_sma20.toFixed(2)}` : null)}
        {fieldRow("Upper", bb_upper != null ? `$${bb_upper.toFixed(2)}` : null)}
        {fieldRow("Lower", bb_lower != null ? `$${bb_lower.toFixed(2)}` : null)}
        {fieldRow("Current", last != null ? `$${last.toFixed(2)}` : null)}
      </div>
      {bucket && bb_position != null && (
        <div style={{
          fontSize:   theme.size.sm,
          color:      theme.text.muted,
          lineHeight: 1.6,
          padding:    `${theme.space[2]}px ${theme.space[3]}px`,
          background: theme.bg.surface,
          borderRadius: theme.radius.sm,
          border:     `1px solid ${theme.border.default}`,
        }}>
          {BB_EXPLANATIONS[bucket](ticker, bb_position)}
        </div>
      )}

      {/* ── IV & Premium Quality section ── */}
      <div style={sectionLabelStyle}>IV &amp; Premium Quality</div>
      {iv != null && iv_rank != null && ivComp != null ? (
        <>
          <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap", marginBottom: theme.space[2] }}>
            {fieldRow("Raw IV", `${(iv * 100).toFixed(0)}%`)}
            {fieldRow("IV Rank", iv_rank.toFixed(1))}
            {fieldRow("Composite", `${ivLabel} (${ivComp.toFixed(2)})`)}
          </div>
          {ivLabel && (IV_EXPLANATIONS[ivLabel] || IV_EXPLANATIONS.Moderate) && (
            <div style={{
              fontSize:     theme.size.sm,
              color:        theme.text.muted,
              lineHeight:   1.6,
              padding:      `${theme.space[2]}px ${theme.space[3]}px`,
              background:   theme.bg.surface,
              borderRadius: theme.radius.sm,
              border:       `1px solid ${theme.border.default}`,
            }}>
              {(IV_EXPLANATIONS[ivLabel] ?? IV_EXPLANATIONS.Moderate)(ticker, iv, iv_rank, ivComp)}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>IV data pending</div>
      )}

      {/* ── Current Positions section ── */}
      <div style={sectionLabelStyle}>Current Positions</div>
      {indicators.length > 0 ? (
        <div style={{ display: "flex", gap: theme.space[2], flexWrap: "wrap" }}>
          {indicators.map((ind, i) => (
            <span key={i} style={{
              fontSize:     theme.size.sm,
              color:        theme.text.secondary,
              background:   theme.bg.surface,
              border:       `1px solid ${theme.border.strong}`,
              borderRadius: theme.radius.sm,
              padding:      "2px 8px",
            }}>
              {ind}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>
          No current positions in this ticker
        </div>
      )}

      {/* ── Scanner Score section ── */}
      <div style={sectionLabelStyle}>Scanner Score</div>
      {score != null && bb_position != null && ivComp != null ? (
        <div style={{ display: "flex", gap: theme.space[4], flexWrap: "wrap", alignItems: "center" }}>
          {fieldRow("Score", `${score.toFixed(3)} (${label})`)}
          <span style={{ ...monoStyle, color: theme.text.subtle }}>
            BB component: {((1 - bb_position) * 0.5).toFixed(3)}
          </span>
          <span style={{ ...monoStyle, color: theme.text.subtle }}>
            IV component: {(ivComp * 0.5).toFixed(3)}
          </span>
          <span style={{ ...monoStyle, color: theme.text.subtle }}>
            Combined: {score.toFixed(3)}
          </span>
        </div>
      ) : (
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>
          Insufficient data to compute score
        </div>
      )}

      {/* ── Earnings section ── */}
      <div style={sectionLabelStyle}>Earnings</div>
      {earningsDate ? (
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], ...monoStyle }}>
          <span style={{ color: theme.text.subtle }}>Next earnings:</span>
          <span style={{ color: theme.text.secondary }}>{earningsDate}</span>
          {daysAway != null && (
            <span style={{ color: theme.text.muted }}>({daysAway} days away)</span>
          )}
          {daysAway != null && daysAway <= 21 ? (
            <span style={{ color: theme.amber, fontWeight: 600 }}>⚠</span>
          ) : (
            <span style={{ color: theme.green }}>✓</span>
          )}
        </div>
      ) : (
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle }}>No earnings date available</div>
      )}
    </div>
  );
}

// ── Filter button ─────────────────────────────────────────────────────────────

function FilterBtn({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background:   active ? theme.bg.elevated : "transparent",
        border:       `1px solid ${active ? theme.border.strong : theme.border.default}`,
        borderRadius: theme.radius.sm,
        color:        active ? theme.text.primary : theme.text.muted,
        fontSize:     theme.size.sm,
        fontFamily:   "inherit",
        cursor:       "pointer",
        padding:      "3px 10px",
        fontWeight:   active ? 600 : 400,
        transition:   "all 0.1s",
      }}
    >
      {label}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RadarTab({ positions = [], marketContext = null }) {
  const { rows, loading, error } = useRadar();

  const [bbFilter, setBbFilter]         = useState("all");
  const [sortBy, setSortBy]             = useState("score");
  const [hideHeld, setHideHeld]         = useState(false);
  const [expandedTicker, setExpandedTicker] = useState(null);

  // Flatten positions for cross-reference.
  // The prop may be a flat array (per spec) or the structured object from useData()
  // { open_csps, assigned_shares, open_leaps, open_spreads }.
  const flatPositions = useMemo(() => {
    if (!positions) return [];
    if (Array.isArray(positions)) return positions;
    // Structured object — flatten all sub-arrays
    const result = [];
    if (Array.isArray(positions.open_csps)) {
      result.push(...positions.open_csps.map(p => ({ ...p, type: p.type ?? "CSP" })));
    }
    if (Array.isArray(positions.open_leaps)) {
      result.push(...positions.open_leaps.map(p => ({ ...p, type: p.type ?? "LEAPS" })));
    }
    if (Array.isArray(positions.open_spreads)) {
      result.push(...positions.open_spreads);
    }
    if (Array.isArray(positions.assigned_shares)) {
      // Each assigned_shares entry represents shares held — also pull nested open_leaps
      for (const s of positions.assigned_shares) {
        result.push({ ticker: s.ticker, position_type: "assigned_shares", type: "shares" });
        if (Array.isArray(s.open_leaps)) {
          result.push(...s.open_leaps.map(p => ({ ...p, type: p.type ?? "LEAPS" })));
        }
      }
    }
    return result;
  }, [positions]);

  // BB data freshness
  const bbAsOf = useMemo(() => {
    const withTs = rows.filter(r => r.bb_refreshed_at);
    if (!withTs.length) return null;
    return withTs.reduce((latest, r) =>
      r.bb_refreshed_at > latest ? r.bb_refreshed_at : latest,
      withTs[0].bb_refreshed_at
    );
  }, [rows]);

  const bbAsOfLabel = useMemo(() => {
    if (!bbAsOf) return null;
    const d = new Date(bbAsOf);
    const now = new Date();
    const ageHours = (now - d) / (1000 * 60 * 60);
    if (ageHours > 3) return "Data may be stale";
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }, [bbAsOf]);

  const bbAsOfStale = useMemo(() => {
    if (!bbAsOf) return false;
    return (new Date() - new Date(bbAsOf)) / (1000 * 60 * 60) > 3;
  }, [bbAsOf]);

  // Filter + sort
  const processedRows = useMemo(() => {
    let result = [...rows];

    // 1. BB filter
    if (bbFilter !== "all") {
      result = result.filter(r => bbBucket(r.bb_position) === bbFilter);
    }

    // 2. Hide held
    if (hideHeld) {
      result = result.filter(r => getPositionIndicators(r.ticker, flatPositions).length === 0);
    }

    // 3. Sort
    if (sortBy === "score") {
      result.sort((a, b) => {
        const sa = scannerScore(a.bb_position, a.iv, a.iv_rank);
        const sb = scannerScore(b.bb_position, b.iv, b.iv_rank);
        if (sa == null && sb == null) return 0;
        if (sa == null) return 1;
        if (sb == null) return -1;
        return sb - sa;
      });
    } else if (sortBy === "bb") {
      result.sort((a, b) => {
        if (a.bb_position == null && b.bb_position == null) return 0;
        if (a.bb_position == null) return 1;
        if (b.bb_position == null) return -1;
        return a.bb_position - b.bb_position;
      });
    } else if (sortBy === "iv_rank") {
      result.sort((a, b) => {
        if (a.iv_rank == null && b.iv_rank == null) return 0;
        if (a.iv_rank == null) return 1;
        if (b.iv_rank == null) return -1;
        return b.iv_rank - a.iv_rank;
      });
    }

    return result;
  }, [rows, bbFilter, hideHeld, sortBy, flatPositions]);

  const strongCount = useMemo(() =>
    processedRows.filter(r => scoreLabel(scannerScore(r.bb_position, r.iv, r.iv_rank)) === "Strong").length,
    [processedRows]
  );

  function handleRowToggle(ticker) {
    setExpandedTicker(prev => prev === ticker ? null : ticker);
  }

  const panelStyle = {
    background:   theme.bg.surface,
    border:       `1px solid ${theme.border.default}`,
    borderRadius: theme.radius.md,
    marginBottom: theme.space[4],
    overflow:     "hidden",
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: `${theme.space[6]}px 0`, color: theme.text.muted, fontSize: theme.size.md }}>
        Loading radar data...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: `${theme.space[6]}px 0`, color: theme.red, fontSize: theme.size.md }}>
        {error}
      </div>
    );
  }

  const SortBtn = ({ id, label }) => (
    <FilterBtn
      label={sortBy === id ? `${label} ▼` : label}
      active={sortBy === id}
      onClick={() => setSortBy(id)}
    />
  );

  return (
    <div>
      {/* ── Filter + sort bar ── */}
      <div style={{
        background:   theme.bg.surface,
        border:       `1px solid ${theme.border.default}`,
        borderRadius: theme.radius.md,
        padding:      `${theme.space[3]}px ${theme.space[4]}px`,
        marginBottom: theme.space[3],
      }}>

        {/* BB Position filters */}
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexWrap: "wrap", marginBottom: theme.space[3] }}>
          <span style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginRight: 4, flexShrink: 0 }}>
            BB Position:
          </span>
          <FilterBtn label="All" active={bbFilter === "all"} onClick={() => setBbFilter("all")} />
          {Object.entries(BB_BUCKET_LABELS).map(([key, label]) => (
            <FilterBtn key={key} label={label} active={bbFilter === key} onClick={() => setBbFilter(key)} />
          ))}
        </div>

        {/* Sort buttons + stats row */}
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[3], flexWrap: "wrap" }}>
          <span style={{ fontSize: theme.size.sm, color: theme.text.subtle, flexShrink: 0 }}>Sort by:</span>
          <SortBtn id="score"   label="Scanner Score" />
          <SortBtn id="bb"      label="BB Position" />
          <SortBtn id="iv_rank" label="IV Rank" />

          <div style={{ flex: 1 }} />

          {/* Hide held checkbox */}
          <label style={{
            display:    "flex",
            alignItems: "center",
            gap:        6,
            fontSize:   theme.size.sm,
            color:      theme.text.muted,
            cursor:     "pointer",
            flexShrink: 0,
          }}>
            <input
              type="checkbox"
              checked={hideHeld}
              onChange={e => setHideHeld(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            Hide positions I already hold
          </label>

          {/* Counts */}
          <span style={{ fontSize: theme.size.sm, color: theme.text.subtle, flexShrink: 0 }}>
            Showing {processedRows.length} tickers
            {strongCount > 0 && (
              <span style={{ color: theme.green }}> · {strongCount} strong candidates</span>
            )}
          </span>
        </div>

        {/* BB freshness */}
        {bbAsOfLabel && (
          <div style={{ marginTop: theme.space[2], fontSize: theme.size.xs, color: bbAsOfStale ? theme.amber : theme.text.subtle }}>
            {bbAsOfStale ? "⚠ " : ""}BB data as of: {bbAsOfLabel}
          </div>
        )}
      </div>

      {/* ── Rows ── */}
      <div style={panelStyle}>
        {processedRows.length === 0 ? (
          <div style={{ padding: `${theme.space[4]}px`, fontSize: theme.size.md, color: theme.text.subtle, textAlign: "center" }}>
            No tickers match the current filter.
          </div>
        ) : (
          processedRows.map(row => (
            <RadarRow
              key={row.ticker}
              row={row}
              positions={flatPositions}
              marketContext={marketContext}
              expanded={expandedTicker === row.ticker}
              onToggle={() => handleRowToggle(row.ticker)}
            />
          ))
        )}
      </div>
    </div>
  );
}
