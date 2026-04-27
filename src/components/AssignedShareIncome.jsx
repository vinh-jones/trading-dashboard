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

function describeBreach(row) {
  if (row.cc_strike == null || row.cc_dte == null) return "—";
  return `rally past ${formatStrike(row.cc_strike)} within ${row.cc_dte}d`;
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
  const cellStyle = {
    padding:        `${theme.space[2]}px ${theme.space[3]}px`,
    borderBottom:   `1px solid ${theme.border.default}`,
    fontSize:       theme.size.sm,
    color:          theme.text.secondary,
    verticalAlign:  "middle",
  };

  const off = !!row.delta_off_target;

  return (
    <tr>
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
        {describeBreach(row)}
      </td>
      <td style={cellStyle}>
        <HealthChip band={row.health_band} />
      </td>
    </tr>
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
