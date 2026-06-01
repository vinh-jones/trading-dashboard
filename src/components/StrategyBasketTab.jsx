import { useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { useQuotes } from "../hooks/useQuotes";
import { theme } from "../lib/theme";
import { TYPE_COLORS } from "../lib/constants";
import { getOpenCSPs, getOpenCCs, getOpenLEAPs } from "../lib/positionSchema";
import {
  resolveBasket, basketTarget, capitalDeployed,
  realizedRecovery, unrealizedCushion,
} from "../lib/strategyBasket";

const STRATEGY_PREFIX = "strategy:";

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
}

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
  const pct = target > 0 ? Math.max(0, Math.min(100, (realized / target) * 100)) : 0;

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

      {/* Progress bar (realized only) */}
      {target > 0 ? (
        <div style={{ marginBottom: theme.space[5] }}>
          <div style={{ height: 10, background: theme.bg.surface, borderRadius: theme.radius.pill, overflow: "hidden", border: `1px solid ${theme.border.default}` }}>
            <div style={{ width: `${pct}%`, height: "100%", background: theme.green, transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: theme.space[1] }}>
            {fmtMoney(realized)} of {fmtMoney(target)} recovered ({pct.toFixed(1)}%)
          </div>
        </div>
      ) : (
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: theme.space[5] }}>
          No baseline set — tag the loss trade with <code>role:makeup-baseline</code> to enable the progress bar.
        </div>
      )}

      {/* Transaction log */}
      <div style={{ fontSize: theme.size.sm, color: theme.text.secondary, marginBottom: theme.space[2], textTransform: "uppercase", letterSpacing: "0.4px" }}>Transactions</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {members.length === 0 && <div style={{ color: theme.text.muted, fontSize: theme.size.sm }}>No members.</div>}
        {members.map((m, i) => (
          <div key={`${m.ticker}-${m.type}-${m.strike}-${m.closeDate ?? m.openDate}-${i}`} style={{
            display: "flex", alignItems: "center", gap: theme.space[3],
            padding: `${theme.space[2]}px ${theme.space[3]}px`,
            background: theme.bg.surface, fontSize: theme.size.sm,
          }}>
            <span style={{ width: 70, fontFamily: theme.font.mono, color: theme.text.muted }}>{m.closeDate ?? m.openDate ?? ""}</span>
            <span style={{ width: 56, fontWeight: 600 }}>{m.ticker}</span>
            <span style={{ width: 64, color: TYPE_COLORS[m.type]?.text ?? theme.text.secondary }}>{m.type}</span>
            <span style={{ flex: 1, color: theme.text.subtle }}>
              {m.role === "baseline" ? "Baseline loss" : m.status === "open" ? "Open" : "Closed"}
              {m.strike != null ? ` · $${m.strike}` : ""}
            </span>
            <span style={{ width: 90, textAlign: "right", fontFamily: theme.font.mono,
              color: m.realized == null ? theme.text.muted : m.realized >= 0 ? theme.green : theme.red }}>
              {m.realized == null ? fmtMoney(-(m.capitalFronted)) : fmtMoney(m.realized)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default StrategyBasketTab;
