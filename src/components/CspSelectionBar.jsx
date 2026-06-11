import { theme } from "../lib/theme";
import { formatDollarsFull } from "../lib/format";

// Selection-tint blue, same rgba(58,130,246,…) family OpenPositionsTab already
// uses for row highlights (matches theme.blue).
const BAR_BORDER = "rgba(58,130,246,0.40)";

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={{
        fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase",
        letterSpacing: "0.5px", fontWeight: 500, marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{ fontSize: theme.size.md, fontWeight: 600, color: color ?? theme.text.primary, whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

// Sticky aggregate readout for the CSP selection calculator. Renders nothing
// until ≥1 row is selected. Desktop: one line of stats. Mobile: count + clear
// line, then a 2×2 stat grid. Right side intentionally ends with the clear
// button — a future "Save as cohort" action slots in before it.
export function CspSelectionBar({ agg, isMobile, onClear }) {
  if (!agg || agg.count === 0) return null;

  const capturedColor = agg.captured == null ? theme.text.muted
    : agg.captured >= 0 ? theme.green : theme.red;

  const collateralValue = (
    <>
      {formatDollarsFull(agg.collateral)}
      {agg.collateralPct != null && (
        <span style={{ color: theme.text.muted, fontWeight: 400 }}>
          {" "}({agg.collateralPct.toFixed(1)}%{isMobile ? "" : " of acct"})
        </span>
      )}
    </>
  );
  const capturedValue = agg.captured != null ? formatDollarsFull(agg.captured) : "—";
  const avgGlValue    = agg.avgGlPct != null ? `${agg.avgGlPct.toFixed(1)}%` : "—";
  const markNote = agg.missingMarkCount > 0 ? (
    <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, whiteSpace: "nowrap" }}>
      *{agg.missingMarkCount} no mark
    </span>
  ) : null;

  const clearBtn = (
    <button
      onClick={onClear}
      style={{
        background: "transparent", border: "none", cursor: "pointer", padding: 0,
        color: theme.text.muted, fontSize: theme.size.sm, fontFamily: "inherit", whiteSpace: "nowrap",
      }}
    >
      ✕ clear
    </button>
  );

  const shell = {
    position:     "fixed",
    left:         "50%",
    transform:    "translateX(-50%)",
    bottom:       `calc(env(safe-area-inset-bottom, 0px) + ${theme.space[3]}px)`,
    zIndex:       50,
    background:   theme.bg.elevated,
    border:       `1px solid ${BAR_BORDER}`,
    borderRadius: theme.radius.md,
    boxShadow:    "0 6px 24px rgba(0,0,0,0.5)",
    padding:      `${theme.space[2]}px ${theme.space[4]}px`,
    fontFamily:   theme.font.mono,
  };

  if (isMobile) {
    return (
      <div style={{ ...shell, width: "calc(100vw - 16px)", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: theme.space[2] }}>
          <span style={{ fontSize: theme.size.sm, color: theme.text.primary }}>
            <span style={{ color: theme.blue, fontWeight: 700 }}>{agg.count}</span> selected {markNote}
          </span>
          {clearBtn}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: `${theme.space[1]}px ${theme.space[4]}px` }}>
          <Stat label="Collateral"  value={collateralValue} />
          <Stat label="Max premium" value={formatDollarsFull(agg.maxPremium)} color={theme.green} />
          <Stat label="Captured"    value={capturedValue} color={capturedColor} />
          <Stat label="Avg G/L"     value={avgGlValue} color={capturedColor} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...shell, display: "flex", alignItems: "center", gap: theme.space[5] }}>
      <Stat label="Selected"    value={agg.count} color={theme.blue} />
      <Stat label="Collateral"  value={collateralValue} />
      <Stat label="Max premium" value={formatDollarsFull(agg.maxPremium)} color={theme.green} />
      <Stat label="Captured"    value={capturedValue} color={capturedColor} />
      <Stat label="Avg G/L"     value={avgGlValue} color={capturedColor} />
      {markNote}
      {clearBtn}
    </div>
  );
}
