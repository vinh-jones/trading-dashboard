import { useMemo, useState } from "react";
import { theme } from "../../lib/theme";
import { computeLifespanVerdict } from "../../lib/tickerVerdict";
import { formatDollars, formatExpiry } from "../../lib/format";
import { VerdictBadge } from "./VerdictBadge";

function StatusPill({ status }) {
  const isActive = status === "active";
  return (
    <span style={{
      fontSize: theme.size.xs, padding: "1px 6px",
      border: `1px solid ${isActive ? theme.green : theme.border.strong}`,
      color: isActive ? theme.green : theme.text.muted,
      borderRadius: theme.radius.sm, letterSpacing: "0.05em",
      textTransform: "uppercase", fontWeight: 600,
    }}>{isActive ? "Active" : "Closed"}</span>
  );
}

function FilterButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 10px", fontSize: theme.size.xs, fontFamily: "inherit",
        cursor: "pointer", color: active ? theme.green : theme.text.muted,
        background: active ? `${theme.green}1a` : "transparent",
        border: `1px solid ${active ? theme.green : theme.border.strong}`,
        borderRadius: theme.radius.pill, fontWeight: 600,
        letterSpacing: "0.05em", textTransform: "uppercase",
      }}
    >{children}</button>
  );
}

// CC strike position vs blended cost basis. Below = absorption risk, At = breakeven, Above = profitable wheel.
const CC_REL_PREFIX = {
  below: { glyph: "▼", title: "below cost — absorption risk if called" },
  at:    { glyph: "■", title: "at cost — break-even if called" },
  above: { glyph: "▲", title: "above cost — profit if called" },
};

function ccRelStyle(rel) {
  if (rel === "below") return { color: theme.amber, ...CC_REL_PREFIX.below };
  if (rel === "at")    return { color: theme.text.muted, ...CC_REL_PREFIX.at };
  if (rel === "above") return { color: theme.green, ...CC_REL_PREFIX.above };
  return null;
}

function relativeToBasis(strike, basis) {
  if (strike == null || basis == null) return null;
  if (strike > basis) return "above";
  if (strike < basis) return "below";
  return "at";
}

function CycleEvents({ lifespan, activeCc }) {
  const events = [];

  for (const a of lifespan.assignment_events ?? []) {
    events.push({
      date: a.date,
      label: a.is_direct_purchase
        ? `Shares bought · ${a.shares_added} sh @ $${a.strike}`
        : `CSP $${a.strike} assigned · ${a.shares_added / 100} ct`,
      color: theme.blue,
    });
  }
  for (const cc of lifespan.cc_history ?? []) {
    const action = cc.is_winning ? "closed" : "rolled";
    const rel = ccRelStyle(cc.relative_to_assignment);
    events.push({
      date: cc.close_date,
      prefix: rel,
      label: `CC $${cc.strike} ${action} · ${cc.contracts ?? 1} ct · ${formatDollars(cc.premium_collected)}${cc.kept_pct != null ? ` (${Math.round(cc.kept_pct * 100)}% kept)` : ""}`,
      color: cc.premium_collected >= 0 ? theme.green : theme.red,
    });
  }
  if (activeCc) {
    const rel = ccRelStyle(relativeToBasis(activeCc.strike, lifespan.blended_cost_basis));
    events.push({
      date: activeCc.open_date,
      prefix: rel,
      label: `CC $${activeCc.strike} opened · ${activeCc.contracts ?? 1} ct · ${formatDollars(activeCc.premium_collected)} prem · expires ${formatExpiry(activeCc.expiry_date)} (open)`,
      color: theme.text.secondary,
    });
  }
  if (lifespan.exit_event) {
    events.push({
      date: lifespan.exit_event.date,
      label: `Shares ${lifespan.exit_event.exit_type === "called_away" ? "called away" : "sold"} @ $${lifespan.exit_event.exit_price ?? "—"} · ${formatDollars(lifespan.exit_event.share_disposal_pnl)}`,
      color: lifespan.exit_event.share_disposal_pnl >= 0 ? theme.green : theme.red,
    });
  }
  events.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  return (
    <div style={{ marginTop: theme.space[3] }}>
      <div style={{
        fontSize: theme.size.xs, color: theme.text.muted,
        textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[2],
      }}>Cycle events</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: `${theme.space[1]}px ${theme.space[3]}px`, fontSize: theme.size.sm }}>
        {events.map((e, i) => (
          <div key={i} style={{ display: "contents" }}>
            <div style={{ color: theme.text.muted, fontFamily: theme.font.mono }}>{e.date && formatExpiry(e.date)}</div>
            <div style={{ color: e.color }}>
              {e.prefix && (
                <span title={e.prefix.title} style={{ color: e.prefix.color, marginRight: 6, fontFamily: theme.font.mono }}>
                  {e.prefix.glyph}
                </span>
              )}
              {e.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Active CC caps the upside on its covered share lot: if currentPrice > strike
// the shares are effectively worth at most the strike (CC will be assigned).
// Uncovered shares (when contracts × 100 < total shares) keep full mark-to-market.
function computeUnrealizedShares({ currentPrice, basis, totalShares, activeCc }) {
  if (currentPrice == null || basis == null || totalShares <= 0) return null;
  const ccContracts = activeCc?.contracts ?? 0;
  const ccStrike    = activeCc?.strike   ?? null;
  const coveredShares   = Math.min(ccContracts * 100, totalShares);
  const uncoveredShares = totalShares - coveredShares;
  const cappedPrice = (ccStrike != null && coveredShares > 0)
    ? Math.min(currentPrice, ccStrike)
    : currentPrice;
  const coveredUnrealized   = coveredShares   > 0 ? (cappedPrice  - basis) * coveredShares   : 0;
  const uncoveredUnrealized = uncoveredShares > 0 ? (currentPrice - basis) * uncoveredShares : 0;
  return coveredUnrealized + uncoveredUnrealized;
}

function computeRunningPnl(lifespan, currentPrice, activeCc) {
  const cspIncome = lifespan.lifespan_metrics?.csp_premium_collected ?? 0;
  const ccIncome  = lifespan.lifespan_metrics?.cc_premium_total ?? 0;
  const totalShares = lifespan.total_shares_at_peak ?? 0;
  const basis       = lifespan.blended_cost_basis  ?? null;
  const capital     = lifespan.total_capital_committed ?? 0;
  const days        = lifespan.lifespan_metrics?.days_active ?? 0;
  const unrealizedShares = computeUnrealizedShares({
    currentPrice, basis, totalShares, activeCc,
  });
  const total = cspIncome + ccIncome + (unrealizedShares ?? 0);

  // Simple annualized return for CC income only — that's the metric the user
  // runs continuously while shares are assigned. CSP income is a one-time event
  // at lifespan start; running total mixes income with mark-to-market — neither
  // annualizes meaningfully.
  const ccIncomeAnnPct = capital > 0 && days > 0
    ? (ccIncome / capital) * (365 / days) * 100
    : null;

  return { cspIncome, ccIncome, unrealizedShares, total, ccIncomeAnnPct };
}

function annPctSub(pct) {
  if (pct == null) return null;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% / yr`;
}

function signed(n) {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${formatDollars(n)}`;
}

function RunningPnlPanel({ running }) {
  const totalColor = running.total >= 0 ? theme.green : theme.red;
  const ccColor    = running.ccIncome >= 0 ? theme.green : theme.red;
  const unrealColor = running.unrealizedShares == null
    ? theme.text.muted
    : running.unrealizedShares >= 0 ? theme.green : theme.red;
  return (
    <div style={{
      marginTop: theme.space[3], padding: theme.space[3],
      background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`,
      borderLeft: `3px solid ${totalColor}`,
      borderRadius: theme.radius.sm,
    }}>
      <div style={{
        fontSize: theme.size.xs, color: theme.text.muted,
        textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[2],
      }}>Running P&amp;L</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: theme.space[3], fontSize: theme.size.sm }}>
        <Stat label="CSP income"        value={signed(running.cspIncome)}         color={theme.blue} />
        <Stat label="CC income (net)"   value={signed(running.ccIncome)}          color={ccColor}      sub={annPctSub(running.ccIncomeAnnPct)} />
        <Stat label="Unrealized shares" value={signed(running.unrealizedShares)}  color={unrealColor} />
        <Stat label="Running total"     value={signed(running.total)}             color={totalColor} />
      </div>
    </div>
  );
}

function VerdictLine({ lifespan }) {
  const spaxx = lifespan.benchmarks?.spaxx_baseline?.vs_actual_pnl;
  const cut   = lifespan.benchmarks?.cut_and_redeploy_baseline?.vs_actual_pnl;
  if (lifespan.lifespan_status === "active") {
    return <span style={{ color: theme.text.muted }}>Lifespan still active — verdict pending close.</span>;
  }
  const parts = [];
  if (spaxx != null) parts.push(`${spaxx >= 0 ? "+" : ""}${formatDollars(spaxx)} vs SPAXX`);
  if (cut   != null) parts.push(`${cut   >= 0 ? "+" : ""}${formatDollars(cut)} vs cut-and-redeploy`);
  if (parts.length === 0) return <span style={{ color: theme.text.muted }}>Insufficient benchmark data.</span>;
  return <span>{parts.join(" · ")}</span>;
}

// Diagnostics describing the trailing-60 CSP sample used as the cut-and-redeploy
// baseline. Two clean signals — gross income rate and assignment risk — kept
// side by side so they can't be confused for a single combined number.
function BaselineDiagnosticsCaption({ lifespan }) {
  const c = lifespan.benchmarks?.cut_and_redeploy_baseline;
  if (!c || !(c.sample_size_csps_used > 0)) return null;

  const parts = [];
  if (c.annualized_income_rate_pct != null) {
    parts.push(`${c.annualized_income_rate_pct.toFixed(1)}% ann income`);
  }
  if (c.assignment_rate_in_baseline != null) {
    parts.push(`${(c.assignment_rate_in_baseline * 100).toFixed(0)}% assign rate`);
  }
  if (c.assignment_count_in_baseline > 0 && c.avg_realized_loss_in_baseline) {
    parts.push(`avg loss ${formatDollars(c.avg_realized_loss_in_baseline)}`);
  }
  if (parts.length === 0) return null;

  return (
    <div style={{
      fontSize: theme.size.xs,
      color: theme.text.subtle,
      marginTop: 2,
    }}>
      Baseline: {parts.join(" · ")} <span style={{ color: theme.text.faint }}>(n={c.sample_size_csps_used})</span>
    </div>
  );
}

// Color tokens for the paired badges in DecisionFramingPanel.
const DRAWDOWN_COLORS = {
  shallow:  { fg: theme.green, bg: theme.alert.successBg },
  moderate: { fg: theme.amber, bg: theme.alert.dangerBg  },
  deep:     { fg: theme.amber, bg: theme.alert.dangerBg  },
  severe:   { fg: theme.red,   bg: theme.alert.dangerBg  },
};

const BREAKEVEN_COLORS = {
  wheel_ahead_perpetually: { fg: theme.green,        bg: theme.alert.successBg },
  quick_recovery:          { fg: theme.green,        bg: theme.alert.successBg },
  decision_zone:           { fg: theme.amber,        bg: theme.alert.dangerBg  },
  long_horizon:            { fg: theme.text.muted,   bg: theme.bg.elevated     },
  effectively_stuck:       { fg: theme.red,          bg: theme.alert.dangerBg  },
};

const BREAKEVEN_LABELS = {
  wheel_ahead_perpetually: "Wheel ahead",
  quick_recovery:          "Quick recovery",
  decision_zone:           "Decision zone",
  long_horizon:            "Long horizon",
  effectively_stuck:       "Effectively stuck",
};

function Badge({ label, color, title }) {
  return (
    <span title={title} style={{
      fontSize: theme.size.xs, padding: "2px 8px",
      color: color.fg, background: color.bg,
      border: `1px solid ${color.fg}`,
      borderRadius: theme.radius.pill,
      letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 600,
    }}>{label}</span>
  );
}

function BreakdownRow({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: theme.space[3], padding: "2px 0" }}>
      <span style={{ color: theme.text.muted }}>{label}</span>
      <span style={{ color: color || theme.text.primary, fontFamily: theme.font.mono }}>{value}</span>
    </div>
  );
}

function DecisionFramingPanel({ framing, ticker }) {
  const drawdownColor  = DRAWDOWN_COLORS[framing.drawdown_zone]   ?? DRAWDOWN_COLORS.moderate;
  const breakevenColor = BREAKEVEN_COLORS[framing.breakeven_zone] ?? BREAKEVEN_COLORS.long_horizon;
  const breakevenLabel = BREAKEVEN_LABELS[framing.breakeven_zone] ?? framing.breakeven_zone;
  const drawdownLabel  = framing.drawdown_zone[0].toUpperCase() + framing.drawdown_zone.slice(1);

  // Default collapsed for shallow + wheel-ahead; expanded for moderate/deep/severe.
  const startExpanded =
    framing.drawdown_zone === "moderate" ||
    framing.drawdown_zone === "deep" ||
    framing.drawdown_zone === "severe";
  const [showDetails, setShowDetails] = useState(startExpanded);

  const d = framing.detailed_breakdown ?? {};
  const isPerpetual = framing.breakeven_zone === "wheel_ahead_perpetually";

  // Accent border color: severity-driven so the panel reads at a glance.
  const accent =
    framing.drawdown_zone === "severe" ? theme.red :
    framing.drawdown_zone === "deep"   ? theme.amber :
    framing.drawdown_zone === "moderate" ? theme.amber :
    theme.green;

  return (
    <div style={{
      marginTop: theme.space[3], padding: theme.space[3],
      background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: theme.radius.sm,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: theme.space[2] }}>
        <div style={{
          fontSize: theme.size.xs, color: theme.text.muted,
          textTransform: "uppercase", letterSpacing: "0.5px",
        }}>Decision Framing</div>
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }}>
          <Badge label={`Drawdown: ${drawdownLabel} (${(framing.drawdown_pct * 100).toFixed(1)}%)`}
                 color={drawdownColor}
                 title="Severity of underwater position vs blended cost basis" />
          <Badge label={`Breakeven: ${breakevenLabel}`}
                 color={breakevenColor}
                 title={isPerpetual
                   ? "Wheel-side daily rate exceeds cut-and-redeploy daily rate; no convergence at current spot"
                   : `Days until cut-and-redeploy alternative would catch up to current wheel state`} />
          {d.trailing_rate_immature && (
            <Badge
              label="Preliminary"
              color={{ fg: theme.text.muted, bg: theme.bg.elevated }}
              title="Days held < 30 — trailing 60-day rate is essentially the lifetime rate; verdict is preliminary" />
          )}
        </div>
      </div>

      {/* Question block */}
      <div style={{ marginTop: theme.space[3] }}>
        {isPerpetual ? (
          <div style={{ color: theme.green, fontSize: theme.size.sm }}>
            {framing.framing_question}
          </div>
        ) : (
          <>
            <div style={{ color: theme.text.primary, fontSize: theme.size.md, fontFamily: theme.font.mono, lineHeight: 1.4 }}>
              {framing.framing_question}
            </div>
            <div style={{ marginTop: 4, fontSize: theme.size.xs, color: theme.text.muted }}>
              {framing.framing_duration} · recovery date {framing.recovery_date}
            </div>
          </>
        )}
      </div>

      {/* Toggle for breakdown */}
      <button
        onClick={() => setShowDetails((v) => !v)}
        style={{
          marginTop: theme.space[3],
          padding: "3px 0", fontSize: theme.size.xs,
          color: theme.text.muted, fontFamily: "inherit",
          background: "none", border: "none", cursor: "pointer",
          letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 600,
        }}
      >
        {showDetails ? "▾ Hide breakdown" : "▸ Show breakdown"}
      </button>

      {showDetails && (
        <div style={{
          marginTop: theme.space[2], paddingTop: theme.space[3],
          borderTop: `1px solid ${theme.border.default}`,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: theme.space[4],
          fontSize: theme.size.sm,
        }}>
          <div>
            <div style={{
              fontSize: theme.size.xs, color: theme.text.muted,
              textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[2],
            }}>Wheel state</div>
            <BreakdownRow label="Cumulative wheel P&L" value={signed(d.cumulative_wheel_pnl)}
                          color={d.cumulative_wheel_pnl >= 0 ? theme.green : theme.red} />
            <BreakdownRow label="CSP premiums"         value={signed(d.csp_premium_collected)} />
            <BreakdownRow label="CC premiums (net)"     value={signed(d.cc_premium_total)}
                          color={d.cc_premium_total >= 0 ? theme.green : theme.red} />
            {d.partial_disposal_pnl !== 0 && (
              <BreakdownRow label="Partial disposal P&L" value={signed(d.partial_disposal_pnl)}
                            color={d.partial_disposal_pnl >= 0 ? theme.green : theme.red} />
            )}
            {d.cc_count_winning != null && (
              <BreakdownRow label="CC win/loss count" value={`${d.cc_count_winning}W / ${d.cc_count_losing}L`} />
            )}
          </div>

          <div>
            <div style={{
              fontSize: theme.size.xs, color: theme.text.muted,
              textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[2],
            }}>Cut alternative (today)</div>
            <BreakdownRow label="Realized loss if cut"  value={signed(-d.realized_loss_if_cut_today)}
                          color={theme.red} />
            <BreakdownRow label="Freed capital"         value={formatDollars(d.freed_capital_if_cut)} />
            <BreakdownRow label="Cut-side state"        value={signed(d.cut_alternative_state)}
                          color={d.cut_alternative_state >= 0 ? theme.green : theme.red} />
            <BreakdownRow label="Gap (wheel − cut)"     value={signed(d.gap)}
                          color={d.gap >= 0 ? theme.green : theme.red} />
            <BreakdownRow label="Current shares"        value={d.current_shares} />
          </div>

          <div>
            <div style={{
              fontSize: theme.size.xs, color: theme.text.muted,
              textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: theme.space[2],
            }}>Forward rates ($/day)</div>
            <BreakdownRow
              label={d.using_trailing_rate ? "Wheel rate (trailing 60d)" : "Wheel rate (lifetime)"}
              value={`$${d.wheel_daily_rate?.toFixed(2)}`} />
            <BreakdownRow label="Cut-redeploy rate" value={`$${d.cut_daily_rate?.toFixed(2)}`} />
            <BreakdownRow label="Daily differential"
                          value={`$${d.daily_differential?.toFixed(2)}`}
                          color={d.daily_differential > 0 ? theme.amber : theme.green} />
            {d.recent_cc_strike != null && (
              <BreakdownRow label="Most recent CC strike" value={`$${d.recent_cc_strike}`} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color, sub }) {
  return (
    <div>
      <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ fontSize: theme.size.md, color: color || theme.text.primary, fontWeight: 500 }}>{value}</div>
      {sub && (
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

function LifespanRow({ lifespan, n, expanded, onToggle, accentColor, currentPrice, activeCc }) {
  const verdict = computeLifespanVerdict(lifespan);
  const status  = lifespan.lifespan_status;
  const isActive = status === "active";

  const closedPnl    = lifespan.lifespan_metrics?.total_lifespan_pnl;
  const closedPnlPct = lifespan.lifespan_metrics?.return_pct_on_capital;
  const running = isActive ? computeRunningPnl(lifespan, currentPrice, activeCc) : null;

  const displayPnl = isActive ? running.total : closedPnl;
  const capital = lifespan.total_capital_committed;
  const displayPct = isActive
    ? (capital > 0 ? displayPnl / capital : null)
    : closedPnlPct;
  const pnlColor = displayPnl == null ? theme.text.muted : displayPnl >= 0 ? theme.green : theme.red;

  return (
    <div style={{
      borderLeft: `3px solid ${accentColor}`,
      background: expanded ? theme.bg.elevated : theme.bg.surface,
      marginBottom: theme.space[2], borderRadius: theme.radius.sm,
    }}>
      <div
        onClick={onToggle}
        style={{
          padding: theme.space[3],
          display: "flex", alignItems: "center", gap: theme.space[3],
          cursor: "pointer", flexWrap: "wrap",
        }}
      >
        <span style={{
          fontSize: theme.size.xs, padding: "1px 6px",
          background: theme.bg.elevated, border: `1px solid ${theme.border.strong}`,
          borderRadius: theme.radius.sm, color: theme.text.muted, fontWeight: 600,
          letterSpacing: "0.05em",
        }}>#{n}</span>
        <StatusPill status={status} />
        <div style={{ fontSize: theme.size.sm, color: theme.text.muted, flex: "1 1 auto" }}>
          {lifespan.assignment_events?.[0]?.date && formatExpiry(lifespan.assignment_events[0].date)}
          {" → "}
          {lifespan.exit_event?.date ? formatExpiry(lifespan.exit_event.date) : "now"}
          {" · "}
          {lifespan.lifespan_metrics?.days_active}d
          {" · peak "}{lifespan.total_shares_at_peak} sh
          {" · "}{formatDollars(lifespan.total_capital_committed)} cap
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
          <VerdictBadge verdict={verdict} />
          <div style={{ textAlign: "right", minWidth: 100 }}>
            <div style={{ color: pnlColor, fontWeight: 600 }}>
              {displayPnl == null ? "—" : `${displayPnl >= 0 ? "+" : ""}${formatDollars(displayPnl)}`}
              {isActive && <span style={{ fontSize: theme.size.xs, color: theme.text.muted, marginLeft: 4 }}>running</span>}
            </div>
            <div style={{ fontSize: theme.size.xs, color: theme.text.muted }}>
              {displayPct == null ? "" : `${(displayPct * 100).toFixed(2)}%`}
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{
          padding: `0 ${theme.space[3]}px ${theme.space[3]}px`,
          borderTop: `1px solid ${theme.border.default}`,
        }}>
          <div style={{ marginTop: theme.space[3], fontSize: theme.size.sm, color: theme.text.secondary }}>
            <VerdictLine lifespan={lifespan} />
            <BaselineDiagnosticsCaption lifespan={lifespan} />
          </div>
          {isActive && <RunningPnlPanel running={running} />}
          {isActive && lifespan.decision_framing && (
            <DecisionFramingPanel framing={lifespan.decision_framing} ticker={lifespan.ticker} />
          )}
          <div style={{ marginTop: theme.space[3], display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: theme.space[3], fontSize: theme.size.sm }}>
            <Stat label="Peak shares" value={lifespan.total_shares_at_peak} />
            <Stat label="Capital" value={formatDollars(lifespan.total_capital_committed)} />
            <Stat label="Days held" value={`${lifespan.lifespan_metrics?.days_active}d`} />
            <Stat label="Return" value={displayPct != null ? `${(displayPct * 100).toFixed(2)}%${isActive ? " (running)" : ""}` : "—"} color={pnlColor} />
          </div>
          <CycleEvents lifespan={lifespan} activeCc={isActive ? activeCc : null} />
        </div>
      )}
    </div>
  );
}

export function TickerLifespanHistory({ data }) {
  const lifespans = data.lifespans ?? [];
  const currentPrice = data.quote?.last ?? data.quote?.mid ?? null;
  // Active CC for the active lifespan: lives on the assigned-shares entry, not on the lifespan itself.
  const activeCc = data.openPositions?.shares?.find((s) => s.active_cc)?.active_cc ?? null;
  const sorted = useMemo(() =>
    [...lifespans].sort((a, b) => (b.assignment_events?.[0]?.date ?? "").localeCompare(a.assignment_events?.[0]?.date ?? "")),
    [lifespans]
  );

  const [filter, setFilter] = useState("all");
  const [expandedIds, setExpandedIds] = useState(() => {
    const active = sorted.find((l) => l.lifespan_status === "active");
    return new Set(active ? [active.assignment_id] : []);
  });

  function toggle(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const filtered = sorted.filter((l) => filter === "all" ? true : l.lifespan_status === filter);

  if (sorted.length === 0) {
    return (
      <div style={{
        padding: theme.space[5], background: theme.bg.surface,
        border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
        marginBottom: theme.space[4],
      }}>
        <div style={{
          fontSize: theme.size.md, color: theme.text.muted,
          textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500,
          marginBottom: theme.space[3],
        }}>Lifespan History · 0 cycles</div>
        <div style={{ color: theme.text.muted, fontSize: theme.size.sm }}>
          No assignment cycles. This ticker is CSP-only — see trade timeline below.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: theme.space[5], background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
      marginBottom: theme.space[4],
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: theme.space[3] }}>
        <div style={{
          fontSize: theme.size.md, color: theme.text.muted,
          textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500,
        }}>Lifespan History · {sorted.length} {sorted.length === 1 ? "cycle" : "cycles"}</div>
        <div style={{ display: "flex", gap: theme.space[1] }}>
          <FilterButton active={filter === "active"} onClick={() => setFilter(filter === "active" ? "all" : "active")}>active</FilterButton>
          <FilterButton active={filter === "closed"} onClick={() => setFilter(filter === "closed" ? "all" : "closed")}>closed</FilterButton>
        </div>
      </div>

      {filtered.map((l) => {
        const n = sorted.length - sorted.indexOf(l);
        const id = l.assignment_id;
        const verdict = computeLifespanVerdict(l);
        const accent = verdict === "ahead"   ? theme.green
                    : verdict === "behind"  ? theme.red
                    : verdict === "suspect" ? theme.amber
                    : l.lifespan_status === "active" ? theme.green
                    : theme.border.strong;
        return (
          <LifespanRow
            key={id ?? `${l.assignment_events?.[0]?.date}-${n}`}
            lifespan={l}
            n={n}
            expanded={expandedIds.has(id)}
            onToggle={() => toggle(id)}
            accentColor={accent}
            currentPrice={currentPrice}
            activeCc={activeCc}
          />
        );
      })}
    </div>
  );
}
