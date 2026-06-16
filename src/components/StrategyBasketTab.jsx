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

// Premium-kept fraction → whole percent: 0.5 → "50%", 0.5582 → "56%".
function fmtKept(frac) {
  if (frac == null || Number.isNaN(frac)) return "—";
  return `${Math.round(frac * 100)}%`;
}

// Whole days from an ISO date to today (browser-local). Null/invalid → null.
function daysSince(iso) {
  if (!iso) return null;
  const t = Date.parse(`${iso}T12:00:00`);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

// Shared column geometry for the transaction table (header + rows stay aligned).
const COL = {
  date:   { width: 64, flexShrink: 0 },
  ticker: { width: 52, flexShrink: 0 },
  type:   { width: 56, flexShrink: 0 },
  detail: { flex: 1, minWidth: 0 },
  days:   { width: 40, flexShrink: 0, textAlign: "right", fontFamily: theme.font.mono },
  kept:   { width: 52, flexShrink: 0, textAlign: "right", fontFamily: theme.font.mono },
  num:    { width: 96, flexShrink: 0, textAlign: "right", fontFamily: theme.font.mono },
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

  // Transaction-table sort. col=null → natural order (baseline pinned, recovery as resolved).
  // Clicking a header cycles that column asc → desc → back to natural.
  const [sort, setSort] = useState({ col: null, dir: "asc" });
  const toggleSort = (col) => setSort(s =>
    s.col !== col      ? { col, dir: "asc" }
    : s.dir === "asc"  ? { col, dir: "desc" }
    :                    { col: null, dir: "asc" }
  );
  // Sortable header cell — click to sort, arrow shows the active column/direction.
  const Th = (col, label, colStyle, sortable = true) => {
    if (!sortable) return <span style={colStyle}>{label}</span>;
    const active = sort.col === col;
    return (
      <span
        onClick={() => toggleSort(col)}
        style={{ ...colStyle, cursor: "pointer", userSelect: "none", color: active ? theme.text.secondary : undefined }}
      >
        {label}{active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
      </span>
    );
  };

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
            {Th("date", "Date", COL.date)}
            {Th("ticker", "Ticker", COL.ticker)}
            {Th("type", "Type", COL.type)}
            {Th("detail", "Detail", COL.detail, false)}
            {Th("days", "Days", COL.days)}
            {Th("kept", "Kept", COL.kept)}
            {Th("collateral", "Collateral", COL.num)}
            {Th("gl", "G/L", COL.num)}
          </div>

          {(() => {
            const baseline = members.filter(m => m.role === "baseline");
            const recovery = members.filter(m => m.role !== "baseline");

            // Derived values shared by row rendering and column sorting.
            // Days: closed → lifespan; open → days held so far.
            // Kept: closed → stored % of premium kept; open short → premium captured so far
            // (unrealized P/L ÷ premium collected). Long LEAPS / baseline have no premium → null.
            const derive = (m) => {
              const open = m.status === "open";
              const gl = open ? memberUnrealized(m, quoteMap) : m.realized;
              const days = open ? daysSince(m.openDate) : m.daysHeld;
              const isShort = m.type === "CSP" || m.type === "CC";
              const kept = m.role === "baseline"
                ? null
                : open
                  ? (isShort && gl != null && m.entryCost && m.contracts
                      ? gl / (m.entryCost * m.contracts * 100)
                      : null)
                  : m.keptPct;
              const collateral = open ? m.capitalFronted : null;
              return { open, gl, days, kept, collateral };
            };

            // Sort the recovery legs by the active column; baseline stays pinned on top.
            // Nulls/blanks always sink to the bottom regardless of direction.
            const sortValue = (m, col) => {
              switch (col) {
                case "date":       return m.closeDate ?? m.openDate ?? null;
                case "ticker":     return m.ticker ?? null;
                case "type":       return m.type ?? null;
                case "days":       return derive(m).days;
                case "kept":       return derive(m).kept;
                case "collateral": return derive(m).collateral;
                case "gl":         return derive(m).gl;
                default:           return null;
              }
            };
            // Compare two members by the active sort column (nulls/blanks sink to the bottom).
            const compareBySort = (a, b) => {
              const va = sortValue(a, sort.col);
              const vb = sortValue(b, sort.col);
              if (va == null && vb == null) return 0;
              if (va == null) return 1;
              if (vb == null) return -1;
              const cmp = (typeof va === "number" && typeof vb === "number")
                ? va - vb
                : String(va).localeCompare(String(vb));
              return sort.dir === "asc" ? cmp : -cmp;
            };
            const sortGroup = (arr) => sort.col ? [...arr].sort(compareBySort) : arr;

            // Open legs always sit above closed legs; the active column sorts within each group.
            const openRecovery   = sortGroup(recovery.filter(m => m.status === "open"));
            const closedRecovery = sortGroup(recovery.filter(m => m.status !== "open"));
            const showGroupLabels = openRecovery.length > 0 && closedRecovery.length > 0;
            const GroupLabel = (text, count) => (
              <div style={{
                display: "flex", gap: theme.space[2], alignItems: "center",
                padding: `${theme.space[1]}px ${theme.space[3]}px`,
                background: theme.bg.elevated, fontSize: theme.size.xs,
                color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.4px",
              }}>
                {text}<span style={{ color: theme.text.subtle }}>· {count}</span>
              </div>
            );

            const Row = (m, i) => {
              const { open, gl, days, kept } = derive(m);
              const glColor = gl == null ? theme.text.muted : gl >= 0 ? theme.green : theme.red;
              const keptColor = kept == null ? theme.text.muted : kept >= 0 ? theme.green : theme.red;

              // Closed recovery legs also show their share of the target in the detail.
              const pctOfTarget = (!open && m.role === "recovery" && target > 0 && m.realized != null)
                ? ` · ${((m.realized / target) * 100).toFixed(1)}% of target`
                : "";
              const detail = m.role === "baseline"
                ? "Baseline loss"
                : `${m.strike != null ? `$${m.strike} · ` : ""}${open ? "open" : "closed"}${pctOfTarget}`;

              return (
                <div key={`${m.status}-${m.ticker}-${m.type}-${m.strike}-${m.closeDate ?? m.openDate}-${i}`} style={{
                  display: "flex", alignItems: "center", gap: theme.space[3],
                  padding: `${theme.space[2]}px ${theme.space[3]}px`,
                  background: theme.bg.surface, fontSize: theme.size.sm,
                }}>
                  <span style={{ ...COL.date, fontFamily: theme.font.mono, color: theme.text.muted }}>{fmtDate(m.closeDate ?? m.openDate)}</span>
                  <span style={{ ...COL.ticker, fontWeight: 600 }}>{m.ticker}</span>
                  <span style={{ ...COL.type, color: TYPE_COLORS[m.type]?.text ?? theme.text.secondary }}>{m.type}</span>
                  <span style={{ ...COL.detail, color: theme.text.subtle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
                  <span style={{ ...COL.days, color: theme.text.muted }}>{days != null ? `${days}d` : "—"}</span>
                  <span style={{ ...COL.kept, color: keptColor }}>{fmtKept(kept)}</span>
                  <span style={{ ...COL.num, color: theme.text.subtle }}>{open ? fmtMoney(m.capitalFronted) : "—"}</span>
                  <span style={{ ...COL.num, color: glColor }}>{gl == null ? "—" : fmtMoney(gl)}</span>
                </div>
              );
            };

            // Totals footer — elapsed time since the swap + blended closed-leg stats.
            const pivotDate   = baseline[0]?.closeDate ?? baseline[0]?.openDate ?? null;
            const daysIn      = daysSince(pivotDate);
            const closedRec   = recovery.filter(m => m.status === "closed");
            const realizedTot = closedRec.reduce((s, m) => s + (m.realized ?? 0), 0);
            const kepts       = closedRec.map(m => m.keptPct).filter(v => v != null);
            const avgKept     = kepts.length ? kepts.reduce((s, v) => s + v, 0) / kepts.length : null;
            const pctTgt      = target > 0 ? (realizedTot / target) * 100 : null;
            const showFooter  = daysIn != null || closedRec.length > 0;

            return (
              <>
                {baseline.map(Row)}
                {baseline.length > 0 && recovery.length > 0 && (
                  <div style={{ height: 2, background: theme.border.strong }} />
                )}
                {showGroupLabels && openRecovery.length > 0 && GroupLabel("Open", openRecovery.length)}
                {openRecovery.map(Row)}
                {showGroupLabels && closedRecovery.length > 0 && GroupLabel("Closed", closedRecovery.length)}
                {closedRecovery.map(Row)}
                {showFooter && (
                  <div style={{
                    display: "flex", gap: theme.space[2], alignItems: "center", flexWrap: "wrap",
                    padding: `${theme.space[2]}px ${theme.space[3]}px`,
                    background: theme.bg.elevated, fontSize: theme.size.xs,
                    color: theme.text.muted, fontFamily: theme.font.mono,
                  }}>
                    {daysIn != null && (
                      <span style={{ color: theme.text.secondary }}>{daysIn} {daysIn === 1 ? "day" : "days"} in</span>
                    )}
                    {daysIn != null && <span>·</span>}
                    <span style={{ color: theme.text.secondary }}>{closedRec.length} closed</span>
                    {closedRec.length > 0 && (
                      <>
                        <span>·</span>
                        <span style={{ color: realizedTot >= 0 ? theme.green : theme.red }}>{fmtMoney(realizedTot)} realized</span>
                        {avgKept != null && (<><span>·</span><span>{fmtKept(avgKept)} avg kept</span></>)}
                        {pctTgt != null && (<><span>·</span><span style={{ color: theme.text.secondary }}>{pctTgt.toFixed(1)}% of target recovered</span></>)}
                      </>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export default StrategyBasketTab;
