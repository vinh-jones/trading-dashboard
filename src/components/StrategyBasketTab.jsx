import { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { useQuotes } from "../hooks/useQuotes";
import { theme } from "../lib/theme";
import { TYPE_COLORS } from "../lib/constants";
import { getOpenCSPs, getOpenCCs, getOpenLEAPs } from "../lib/positionSchema";
import {
  resolveBasket, basketTarget, capitalDeployed,
  realizedRecovery, unrealizedCushion, memberUnrealized, holdCounterfactual,
} from "../lib/strategyBasket";

const STRATEGY_PREFIX = "strategy:";

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
}

// ISO "YYYY-MM-DD" → "MM/DD/YY". Passes through anything non-ISO unchanged.
function fmtDate(d) {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : String(d);
}

// Shared column geometry for the transaction table (header + rows stay aligned).
const COL = {
  date:   { width: 64, flexShrink: 0 },
  ticker: { width: 52, flexShrink: 0 },
  type:   { width: 60, flexShrink: 0 },
  detail: { flex: 1, minWidth: 0 },
  num:    { width: 100, flexShrink: 0, textAlign: "right", fontFamily: theme.font.mono },
};

function flattenOpen(positions) {
  return [
    ...getOpenCSPs(positions).map(p => ({ ...p, type: "CSP" })),
    ...getOpenCCs(positions).map(p => ({ ...p, type: "CC" })),
    ...getOpenLEAPs(positions).map(p => ({ ...p, type: "LEAPS" })),
  ];
}

function Card({ label, value, sub, valueColor }) {
  return (
    <div style={{
      flex: "1 1 160px", padding: theme.space[3],
      background: theme.bg.surface, border: `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md,
    }}>
      <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.4px" }}>{label}</div>
      <div style={{ fontSize: theme.size.lg, fontFamily: theme.font.mono, color: valueColor ?? theme.text.primary, marginTop: theme.space[1] }}>{value}</div>
      {sub && <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function StrategyBasketTab({ initialTag = null, entries = [] }) {
  const { positions, trades } = useData();
  const { quoteMap } = useQuotes();

  const strategyTags = useMemo(() => {
    const set = new Set();
    for (const e of entries) {
      for (const t of (e.tags ?? [])) if (t.startsWith(STRATEGY_PREFIX)) set.add(t);
    }
    return [...set].sort();
  }, [entries]);

  const [selectedTag, setSelectedTag] = useState(initialTag);
  const activeTag = (selectedTag && strategyTags.includes(selectedTag))
    ? selectedTag
    : (strategyTags[0] ?? null);

  const openPositions = useMemo(() => flattenOpen(positions), [positions]);
  const members = useMemo(
    () => activeTag ? resolveBasket(activeTag, { openPositions, trades: trades ?? [], entries }) : [],
    [activeTag, openPositions, trades, entries],
  );

  const target    = basketTarget(members);
  const deployed  = capitalDeployed(members);
  const realized  = realizedRecovery(members);
  const cushion   = unrealizedCushion(members, quoteMap);

  // Stacked progress: locked-in realized fill + paper unrealized fill toward target.
  const clampPct = (v) => Math.max(0, Math.min(100, v));
  const realizedFill   = target > 0 ? clampPct((Math.max(0, realized) / target) * 100) : 0;
  const cushionPos     = Math.max(0, cushion.total);
  const combinedFill   = target > 0 ? clampPct(((Math.max(0, realized) + cushionPos) / target) * 100) : 0;
  const unrealizedFill = Math.max(0, combinedFill - realizedFill);

  if (strategyTags.length === 0) {
    return <div style={{ padding: theme.space[5], color: theme.text.muted }}>No positions tagged with a <code>strategy:</code> tag yet.</div>;
  }

  return (
    <div>
      {/* Tag selector */}
      <div style={{ display: "flex", gap: theme.space[2], marginBottom: theme.space[4], flexWrap: "wrap" }}>
        {strategyTags.map(t => (
          <button key={t} onClick={() => setSelectedTag(t)} style={{
            padding: "6px 14px", fontSize: theme.size.sm, cursor: "pointer", fontFamily: "inherit",
            background: t === activeTag ? theme.bg.elevated : theme.bg.surface,
            color: t === activeTag ? theme.blue : theme.text.muted,
            border: `1px solid ${t === activeTag ? theme.blue : theme.border.default}`,
            borderRadius: theme.radius.pill,
          }}>{t.replace(STRATEGY_PREFIX, "")}</button>
        ))}
      </div>

      {/* Summary cards */}
      <div style={{ display: "flex", gap: theme.space[3], flexWrap: "wrap", marginBottom: theme.space[4] }}>
        <Card label="Target to recover" value={target > 0 ? fmtMoney(target) : "—"} />
        <Card label="Capital deployed" value={fmtMoney(deployed)} />
        <Card label="Realized recovery" value={fmtMoney(realized)} valueColor={realized >= 0 ? theme.green : theme.red} />
        <Card
          label="Unrealized cushion"
          value={cushion.marked > 0 ? fmtMoney(cushion.total) : "—"}
          valueColor={cushion.total >= 0 ? theme.green : theme.red}
          sub={cushion.unmarked > 0 ? `${cushion.unmarked} unmarked (mark-to-market)` : "mark-to-market"}
        />
      </div>

      {/* Progress bar: realized (solid) + unrealized cushion (lighter) stacked toward target */}
      {target > 0 ? (
        <div style={{ marginBottom: theme.space[5] }}>
          <div style={{ display: "flex", height: 10, background: theme.bg.surface, borderRadius: theme.radius.pill, overflow: "hidden", border: `1px solid ${theme.border.default}` }}>
            <div style={{ width: `${realizedFill}%`, height: "100%", background: theme.green, transition: "width 0.3s" }} />
            <div style={{ width: `${unrealizedFill}%`, height: "100%", background: theme.green, opacity: 0.35, transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: theme.space[1] }}>
            {fmtMoney(realized)} realized + {fmtMoney(cushion.total)} unrealized of {fmtMoney(target)} ({combinedFill.toFixed(1)}%)
            {cushion.unmarked > 0 ? ` · ${cushion.unmarked} position${cushion.unmarked > 1 ? "s" : ""} unmarked` : ""}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: theme.space[5] }}>
          No baseline set — tag the loss trade with <code>role:makeup-baseline</code> to enable the progress bar.
        </div>
      )}

      {/* A/B: makeup basket vs. just holding the closed underlying */}
      {(() => {
        const baseline = members.find(m => m.role === "baseline");
        if (!baseline) return null;
        const cur = quoteMap.get(baseline.ticker)?.mid ?? quoteMap.get(baseline.ticker)?.last ?? null;
        const holdGain = holdCounterfactual(baseline, cur);
        if (holdGain == null) return null;
        const basketGain = realized + cushion.total;
        const maxAbs = Math.max(Math.abs(basketGain), Math.abs(holdGain), 1);
        const delta  = basketGain - holdGain;

        const CmpRow = (label, value) => (
          <div style={{ display: "flex", alignItems: "center", gap: theme.space[3], marginBottom: theme.space[1] }}>
            <span style={{ width: 150, fontSize: theme.size.sm, color: theme.text.secondary }}>{label}</span>
            <span style={{ width: 80, textAlign: "right", fontFamily: theme.font.mono, fontSize: theme.size.sm, color: value >= 0 ? theme.green : theme.red }}>{fmtMoney(value)}</span>
            <div style={{ flex: 1, height: 8, background: theme.bg.base, borderRadius: theme.radius.pill, overflow: "hidden" }}>
              <div style={{ width: `${(Math.abs(value) / maxAbs) * 100}%`, height: "100%", background: value >= 0 ? theme.green : theme.red, transition: "width 0.3s" }} />
            </div>
          </div>
        );

        return (
          <div style={{ marginBottom: theme.space[5], padding: theme.space[3], background: theme.bg.surface, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: theme.space[2] }}>
              <span style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.4px" }}>vs. holding {baseline.ticker}</span>
              <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>since {fmtDate(baseline.closeDate ?? baseline.openDate)}</span>
            </div>
            {CmpRow("Makeup basket", basketGain)}
            {CmpRow(`Hold ${baseline.contracts != null ? baseline.contracts.toLocaleString() : "?"} @ $${baseline.exitCost}`, holdGain)}
            <div style={{ fontSize: theme.size.sm, color: theme.text.secondary, marginTop: theme.space[2] }}>
              → {delta >= 0 ? "Makeup" : "Holding"} ahead by {fmtMoney(Math.abs(delta))}
            </div>
            <div style={{ fontSize: theme.size.xs, color: theme.text.faint ?? theme.text.subtle, marginTop: theme.space[1] }}>
              Mark-to-market since the pivot · not capital-matched · excludes covered-call premium the shares would have earned
            </div>
          </div>
        );
      })()}

      {/* Transaction log */}
      <div style={{ fontSize: theme.size.sm, color: theme.text.secondary, marginBottom: theme.space[2], textTransform: "uppercase", letterSpacing: "0.4px" }}>Transactions</div>
      {members.length === 0 ? (
        <div style={{ color: theme.text.muted, fontSize: theme.size.sm }}>No members.</div>
      ) : (
        <div style={{
          display: "flex", flexDirection: "column", gap: 1,
          background: theme.border.default,
          border: `1px solid ${theme.border.default}`,
          borderRadius: theme.radius.md, overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", gap: theme.space[3],
            padding: `${theme.space[2]}px ${theme.space[3]}px`,
            background: theme.bg.elevated,
            fontSize: theme.size.xs, color: theme.text.muted,
            textTransform: "uppercase", letterSpacing: "0.4px",
          }}>
            <span style={COL.date}>Date</span>
            <span style={COL.ticker}>Ticker</span>
            <span style={COL.type}>Type</span>
            <span style={COL.detail}>Detail</span>
            <span style={COL.num}>Collateral</span>
            <span style={COL.num}>G/L</span>
          </div>

          {(() => {
            const baseline = members.filter(m => m.role === "baseline");
            const recovery = members.filter(m => m.role !== "baseline");

            const Row = (m, i) => {
              const open = m.status === "open";
              const gl = open ? memberUnrealized(m, quoteMap) : m.realized;
              const glColor = gl == null ? theme.text.muted : gl >= 0 ? theme.green : theme.red;
              const detail = m.role === "baseline"
                ? "Baseline loss"
                : `${m.strike != null ? `$${m.strike} · ` : ""}${open ? "open" : "closed"}`;
              return (
                <div key={`${m.ticker}-${m.type}-${m.strike}-${m.closeDate ?? m.openDate}-${i}`} style={{
                  display: "flex", alignItems: "center", gap: theme.space[3],
                  padding: `${theme.space[2]}px ${theme.space[3]}px`,
                  background: theme.bg.surface, fontSize: theme.size.sm,
                }}>
                  <span style={{ ...COL.date, fontFamily: theme.font.mono, color: theme.text.muted }}>{fmtDate(m.closeDate ?? m.openDate)}</span>
                  <span style={{ ...COL.ticker, fontWeight: 600 }}>{m.ticker}</span>
                  <span style={{ ...COL.type, color: TYPE_COLORS[m.type]?.text ?? theme.text.secondary }}>{m.type}</span>
                  <span style={{ ...COL.detail, color: theme.text.subtle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
                  <span style={{ ...COL.num, color: theme.text.subtle }}>{open ? fmtMoney(m.capitalFronted) : "—"}</span>
                  <span style={{ ...COL.num, color: glColor }}>{gl == null ? "—" : fmtMoney(gl)}</span>
                </div>
              );
            };

            return (
              <>
                {baseline.map(Row)}
                {baseline.length > 0 && recovery.length > 0 && (
                  <div style={{ height: 2, background: theme.border.strong }} />
                )}
                {recovery.map(Row)}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export default StrategyBasketTab;
