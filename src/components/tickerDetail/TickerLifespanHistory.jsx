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
      label: `CSP $${a.strike} assigned · ${a.shares_added / 100} ct`,
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

  // Simple annualized return (non-compounded) — e.g. 1.8k income on 52.5k cap
  // over 98 days → 12.8%/yr. Skip when we'd divide by zero.
  const annualize = (amount) =>
    capital > 0 && days > 0 ? (amount / capital) * (365 / days) * 100 : null;

  return {
    cspIncome,
    ccIncome,
    unrealizedShares,
    total,
    cspIncomeAnnPct: annualize(cspIncome),
    ccIncomeAnnPct:  annualize(ccIncome),
    totalAnnPct:     annualize(total),
  };
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
        <Stat label="CSP income"        value={signed(running.cspIncome)}         color={theme.blue}   sub={annPctSub(running.cspIncomeAnnPct)} />
        <Stat label="CC income (net)"   value={signed(running.ccIncome)}          color={ccColor}      sub={annPctSub(running.ccIncomeAnnPct)} />
        <Stat label="Unrealized shares" value={signed(running.unrealizedShares)}  color={unrealColor} />
        <Stat label="Running total"     value={signed(running.total)}             color={totalColor}   sub={annPctSub(running.totalAnnPct)} />
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
          </div>
          {isActive && <RunningPnlPanel running={running} />}
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
