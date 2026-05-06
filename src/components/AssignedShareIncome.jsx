import React from "react";
import { theme } from "../lib/theme";
import { useAssignedShareIncome } from "../hooks/useAssignedShareIncome";
import { formatDollars } from "../lib/format";

const BAND_LABELS = {
  healthy:    "Healthy",
  recovering: "Recovering",
  grinding:   "Grinding",
};

const BAND_COLORS = {
  healthy:    theme.green,
  recovering: theme.amber,
  grinding:   theme.red,
};

const BAND_ORDER = ["healthy", "recovering", "grinding"];

function formatPct(decimal) {
  if (decimal == null || isNaN(decimal)) return "—";
  const sign = decimal >= 0 ? "+" : "";
  return `${sign}${(decimal * 100).toFixed(1)}%`;
}

function formatStrike(value) {
  if (value == null || isNaN(value)) return "—";
  return `$${Number(value).toFixed(value >= 100 ? 0 : 2)}`;
}

function describeStrike(row) {
  if (row.cc_strike == null) return "—";
  let tag;
  if (row.regime === "active_cc") {
    tag = row.cc_dte != null ? `Active (${row.cc_dte}d)` : "Active";
  } else if (row.regime === "above_assignment") {
    tag = "ATM (4w)";
  } else {
    tag = "9Δ (1w)";
  }
  return `${tag} ${formatStrike(row.cc_strike)}`;
}

// Red indicator fires only at ≤21 DTE; amber only at ≤14 DTE.
// Above-assignment breach is a profitable exit — no DTE gating needed.
function shouldSuppressIndicator(row) {
  const sigmas  = row.cc_sigmas_to_breach;
  const dte     = row.cc_dte;
  const isAbove = row.distance_pct != null && row.distance_pct >= 0;
  if (isAbove || sigmas == null || dte == null) return false;
  if (sigmas < 0.5) return dte > 21;
  if (sigmas < 1.0) return dte > 14;
  return false;
}

// Below-assignment shares: a breach locks in loss territory, so frame
// sigmas as cushion (red→amber→neutral→green as strike gets farther away).
function sigmaBucketRisk(sigmas) {
  if (sigmas == null) return null;
  if (sigmas <  0  ) return { label: "ITM",          color: theme.red };
  if (sigmas <  0.5) return { label: "at the door",  color: theme.red };
  if (sigmas <  1.0) return { label: "in range",     color: theme.amber };
  if (sigmas <  2.0) return { label: "needs a push", color: theme.text.secondary };
  if (sigmas <  3.0) return { label: "well covered", color: theme.green };
  return                   { label: "deep OTM",      color: theme.text.muted };
}

// Above-assignment shares: a breach is a profitable exit, so frame
// sigmas as cushion (neutral/positive coloring throughout).
function sigmaBucketExit(sigmas) {
  if (sigmas == null) return null;
  if (sigmas <  0  ) return { label: "ITM exit",     color: theme.green };
  if (sigmas <  0.5) return { label: "at the door",  color: theme.green };
  if (sigmas <  1.0) return { label: "in range",     color: theme.green };
  if (sigmas <  2.0) return { label: "needs a push", color: theme.text.secondary };
  if (sigmas <  3.0) return { label: "well covered", color: theme.text.muted };
  return                   { label: "deep OTM",      color: theme.text.muted };
}

function BreachWatch({ row, showIndicator = true }) {
  if (row.cc_strike == null || row.cc_dte == null) {
    return <span>—</span>;
  }
  const movePct = row.cc_required_move_pct;
  const sigmas  = row.cc_sigmas_to_breach;
  const dte     = row.cc_dte;

  // Above-assignment ATM picks have ~0% required move; "ATM" reads cleaner
  // than "+0% in 28d (0σ)".
  if (row.regime === "above_assignment" && movePct != null && Math.abs(movePct) < 0.01) {
    return <span>ATM, {dte}d</span>;
  }

  const moveText = movePct != null
    ? `${movePct >= 0 ? "+" : ""}${(movePct * 100).toFixed(1)}% in ${dte}d`
    : `rally past ${formatStrike(row.cc_strike)} within ${dte}d`;

  const isAbove = row.distance_pct != null && row.distance_pct >= 0;
  const bucket  = showIndicator
    ? (isAbove ? sigmaBucketExit(sigmas) : sigmaBucketRisk(sigmas))
    : null;

  return (
    <span>
      {moveText}
      {bucket && (
        <>
          {" · "}
          <span style={{ color: bucket.color, fontWeight: 600 }}>{bucket.label}</span>
          {sigmas != null && (
            <span style={{ color: theme.text.faint, marginLeft: theme.space[1] }}>
              ({sigmas.toFixed(1)}σ)
            </span>
          )}
        </>
      )}
    </span>
  );
}

function HealthChip({ band }) {
  if (!band || !BAND_LABELS[band]) {
    return <span style={{ color: theme.text.subtle }}>—</span>;
  }
  const color = BAND_COLORS[band];
  return (
    <span style={{
      display:        "inline-block",
      padding:        `2px ${theme.space[2]}px`,
      background:     theme.bg.elevated,
      border:         `1px solid ${color}`,
      borderRadius:   theme.radius.pill,
      color,
      fontSize:       theme.size.xs,
      fontWeight:     600,
      textTransform:  "uppercase",
      letterSpacing:  "0.5px",
    }}>
      {BAND_LABELS[band]}
    </span>
  );
}

function AggregateCard({ aggregate }) {
  const totalRaw     = aggregate?.total_monthly_income ?? 0;
  const totalOnTgt   = aggregate?.total_monthly_income_on_target ?? 0;
  const offTargetCnt = aggregate?.delta_off_target_count ?? 0;

  return (
    <div style={{
      background:    theme.bg.surface,
      border:        `1px solid ${theme.border.default}`,
      borderRadius:  theme.radius.md,
      padding:       `${theme.space[4]}px ${theme.space[5]}px`,
      marginBottom:  theme.space[4],
    }}>
      <div style={{ display: "flex", gap: theme.space[6], flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[1] }}>
            Aggregate income capacity
          </div>
          <div style={{ fontSize: theme.size.xxl, color: theme.text.primary, fontWeight: 600, lineHeight: 1.1 }}>
            {formatDollars(totalRaw)}
            <span style={{ fontSize: theme.size.md, color: theme.text.muted, fontWeight: 400, marginLeft: theme.space[1] }}>/ mo</span>
          </div>
        </div>

        <div>
          <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[1] }}>
            On-target only
          </div>
          <div style={{ fontSize: theme.size.xl, color: theme.text.secondary, fontWeight: 500, lineHeight: 1.1 }}>
            {formatDollars(totalOnTgt)}
            <span style={{ fontSize: theme.size.sm, color: theme.text.muted, fontWeight: 400, marginLeft: theme.space[1] }}>/ mo</span>
          </div>
          {offTargetCnt > 0 && (
            <div style={{ fontSize: theme.size.xs, color: theme.amber, marginTop: 2 }}>
              {offTargetCnt} position{offTargetCnt === 1 ? "" : "s"} off 9Δ target
            </div>
          )}
        </div>
      </div>

      <div style={{
        display:    "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap:        theme.space[3],
        marginTop:  theme.space[4],
        paddingTop: theme.space[3],
        borderTop:  `1px solid ${theme.border.default}`,
      }}>
        {BAND_ORDER.map(band => {
          const cell = aggregate?.[band] ?? { count: 0, monthly_income: 0 };
          const color = BAND_COLORS[band];
          return (
            <div key={band}>
              <div style={{ fontSize: theme.size.xs, color, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>
                {BAND_LABELS[band]}
              </div>
              <div style={{ fontSize: theme.size.lg, color: theme.text.primary, fontWeight: 600, marginTop: 2 }}>
                {formatDollars(cell.monthly_income)}
                <span style={{ fontSize: theme.size.xs, color: theme.text.muted, fontWeight: 400, marginLeft: theme.space[1] }}>/ mo</span>
              </div>
              <div style={{ fontSize: theme.size.xs, color: theme.text.muted }}>
                {cell.count} position{cell.count === 1 ? "" : "s"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PositionRow({ row }) {
  const [expanded, setExpanded] = React.useState(false);
  const suppressed = shouldSuppressIndicator(row);

  const cellStyle = {
    padding:        `${theme.space[2]}px ${theme.space[3]}px`,
    borderBottom:   expanded ? "none" : `1px solid ${theme.border.default}`,
    fontSize:       theme.size.sm,
    color:          theme.text.secondary,
    verticalAlign:  "middle",
  };

  const off = !!row.delta_off_target;
  const dteCutoff = row.cc_sigmas_to_breach != null && row.cc_sigmas_to_breach < 0.5 ? 21 : 14;

  return (
    <>
      <tr onClick={() => setExpanded(e => !e)} style={{ cursor: "pointer" }}>
        <td style={{ ...cellStyle, color: theme.text.primary, fontWeight: 600 }}>
          {row.ticker}
          {row.has_active_cc && (
            <span style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginLeft: theme.space[1] }}>·CC</span>
          )}
        </td>
        <td style={{ ...cellStyle, color: row.distance_pct != null && row.distance_pct < 0 ? theme.red : theme.text.secondary }}>
          {formatPct(row.distance_pct)}
        </td>
        <td style={cellStyle}>{row.iv_rank != null ? row.iv_rank : "—"}</td>
        <td style={cellStyle}>{describeStrike(row)}</td>
        <td style={{ ...cellStyle, color: theme.green, fontWeight: 500 }}>
          {row.monthly_income != null ? formatDollars(row.monthly_income) : "—"}
          {off && (
            <span
              title={`Chosen Δ ${row.cc_delta?.toFixed(2)} is outside target 0.05–0.13 band`}
              style={{
                display:       "inline-block",
                width:         8,
                height:        8,
                borderRadius:  "50%",
                background:    theme.amber,
                marginLeft:    theme.space[2],
                verticalAlign: "middle",
              }}
            />
          )}
        </td>
        <td style={{ ...cellStyle, color: theme.text.muted, fontSize: theme.size.xs }}>
          <BreachWatch row={row} showIndicator={!suppressed} />
        </td>
        <td style={cellStyle}>
          <HealthChip band={row.health_band} />
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{
            padding:      `${theme.space[2]}px ${theme.space[3]}px`,
            borderBottom: `1px solid ${theme.border.default}`,
            background:   theme.bg.elevated,
            fontSize:     theme.size.xs,
          }}>
            <div style={{ display: "flex", gap: theme.space[4], alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: theme.text.muted }}>
                <BreachWatch row={row} showIndicator={true} />
              </span>
              {row.cc_atm_iv != null && (
                <span style={{ color: theme.text.subtle }}>
                  ATM IV: {(row.cc_atm_iv * 100).toFixed(0)}%
                </span>
              )}
              {row.cc_delta != null && (
                <span style={{ color: theme.text.subtle }}>
                  Δ {row.cc_delta.toFixed(2)}
                </span>
              )}
              {suppressed && (
                <span style={{ color: theme.text.faint }}>
                  indicator fires at ≤{dteCutoff}d DTE
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function AssignedShareIncome() {
  const { data, loading, error } = useAssignedShareIncome();

  const sectionTitleStyle = {
    fontSize:       theme.size.md,
    color:          theme.text.primary,
    fontWeight:     600,
    textTransform:  "uppercase",
    letterSpacing:  "0.5px",
    marginBottom:   theme.space[3],
    marginTop:      theme.space[5],
  };

  if (loading && !data) {
    return (
      <div>
        <div style={sectionTitleStyle}>Assigned Shares — Income & Health</div>
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, padding: theme.space[3] }}>
          Loading income capacity from option chain…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div style={sectionTitleStyle}>Assigned Shares — Income & Health</div>
        <div style={{
          fontSize:     theme.size.sm,
          color:        theme.red,
          padding:      theme.space[3],
          background:   theme.alert.dangerBg,
          border:       `1px solid ${theme.alert.dangerBorder}`,
          borderRadius: theme.radius.sm,
        }}>
          Failed to load: {error}
        </div>
      </div>
    );
  }

  const rows = data?.per_position ?? [];
  const sorted = [...rows].sort((a, b) => {
    const order = { healthy: 0, recovering: 1, grinding: 2 };
    const ba = order[a.health_band] ?? 3;
    const bb = order[b.health_band] ?? 3;
    if (ba !== bb) return ba - bb;
    return (b.monthly_income ?? 0) - (a.monthly_income ?? 0);
  });

  const headerCell = {
    padding:       `${theme.space[2]}px ${theme.space[3]}px`,
    fontSize:      theme.size.xs,
    color:         theme.text.subtle,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    fontWeight:    600,
    textAlign:     "left",
    borderBottom:  `1px solid ${theme.border.strong}`,
  };

  return (
    <div>
      <div style={sectionTitleStyle}>Assigned Shares — Income & Health</div>

      <AggregateCard aggregate={data?.aggregate} />

      {rows.length === 0 ? (
        <div style={{ fontSize: theme.size.sm, color: theme.text.subtle, padding: theme.space[3] }}>
          No assigned-share positions.
        </div>
      ) : (
        <div style={{
          background:    theme.bg.surface,
          border:        `1px solid ${theme.border.default}`,
          borderRadius:  theme.radius.md,
          overflow:      "hidden",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={headerCell}>Ticker</th>
                <th style={headerCell}>Distance</th>
                <th style={headerCell}>IVR</th>
                <th style={headerCell}>CC Strike</th>
                <th style={headerCell}>$/mo</th>
                <th style={headerCell}>Breach Watch</th>
                <th style={headerCell}>Health</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => <PositionRow key={row.ticker} row={row} />)}
            </tbody>
          </table>
        </div>
      )}

      {data?.fetched_at && (
        <div style={{ fontSize: theme.size.xs, color: theme.text.faint, marginTop: theme.space[2], textAlign: "right" }}>
          chain snapshot: {new Date(data.fetched_at).toLocaleString()}
          {data.cached ? " (cached)" : ""}
        </div>
      )}
    </div>
  );
}
