import { useEffect, useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { useQuotes } from "../hooks/useQuotes";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { theme } from "../lib/theme";
import { formatDollars, formatExpiry } from "../lib/format";
import { buildTickerDirectory } from "../lib/tickerDirectory";
import { computePositionHealth } from "../lib/tickerHealth";

const COL_DEFS = [
  { key: "ticker",       label: "TICKER",        align: "left"  },
  { key: "status",       label: "STATUS",        align: "left"  },
  { key: "lastActivity", label: "LAST ACTIVITY", align: "left"  },
  { key: "cycles",       label: "CYCLES",        align: "right" },
  { key: "lifetimePnl",  label: "LIFETIME P&L",  align: "right" },
  { key: "capital",      label: "CAPITAL",       align: "right" },
  { key: "health",       label: "HEALTH",        align: "left"  },
];

function compareRows(a, b, sortKey, sortDir) {
  let av, bv;
  switch (sortKey) {
    case "ticker":       av = a.ticker;        bv = b.ticker;        break;
    case "status":       av = a.status;        bv = b.status;        break;
    case "lastActivity": av = a.lastActivity;  bv = b.lastActivity;  break;
    case "cycles":       av = a.cycles;        bv = b.cycles;        break;
    case "lifetimePnl":  av = a.lifetimePnl;   bv = b.lifetimePnl;   break;
    case "capital":      av = a.capital;       bv = b.capital;       break;
    case "health":
      av = a.hasOpenPositions ? 1 : 0;
      bv = b.hasOpenPositions ? 1 : 0;
      break;
    default: return 0;
  }
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "string") {
    const cmp = av.localeCompare(bv);
    return sortDir === "desc" ? -cmp : cmp;
  }
  return sortDir === "desc" ? bv - av : av - bv;
}

function openPositionsForTicker(positions, ticker) {
  return {
    csps:   (positions?.open_csps      ?? []).filter((p) => p.ticker === ticker),
    shares: (positions?.assigned_shares ?? []).filter((s) => s.ticker === ticker),
    leaps:  (positions?.open_leaps     ?? []).filter((l) => l.ticker === ticker),
  };
}

function quoteFor(quoteMap, ticker) {
  const q = quoteMap?.get?.(ticker);
  if (!q) return null;
  return { last: q.last, mid: q.mid };
}

function StatusCell({ status }) {
  const isActive = status === "active";
  const color = isActive ? theme.green : theme.text.muted;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: color, display: "inline-block",
        opacity: isActive ? 1 : 0.5,
      }} />
      {isActive ? "Active" : "Idle"}
    </span>
  );
}

function HealthCell({ ticker, positions, quoteMap, hasOpenPositions }) {
  if (!hasOpenPositions) return <span style={{ color: theme.text.faint }}>—</span>;
  const open = openPositionsForTicker(positions, ticker);
  const quote = quoteFor(quoteMap, ticker);
  const h = computePositionHealth({ openPositions: open, quote });
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: h.color }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: h.color, display: "inline-block",
      }} />
      {h.label}
    </span>
  );
}

function PnlCell({ value, includesSuspect }) {
  if (value === 0) return <span style={{ color: theme.text.muted }}>$0</span>;
  const color = value >= 0 ? theme.green : theme.red;
  const sign  = value >= 0 ? "+" : "";
  return (
    <span style={{ color, fontWeight: 600 }}>
      {sign}{formatDollars(value)}
      {includesSuspect && <span style={{ color: theme.amber, marginLeft: 4 }}>*</span>}
    </span>
  );
}

function CyclesCell({ row, lifespanLoading, lifespanError }) {
  if (lifespanLoading) return <span style={{ color: theme.text.faint }}>…</span>;
  if (lifespanError) return <span style={{ color: theme.amber }}>?</span>;
  if (row.cyclesSuspect > 0) {
    return (
      <span>
        {row.cycles}
        <span style={{ color: theme.amber, marginLeft: 4, fontSize: theme.size.xs }}>
          ({row.cyclesSuspect} suspect)
        </span>
      </span>
    );
  }
  return <span>{row.cycles}</span>;
}

export function TickersTab({ onOpenTickerDetail }) {
  const { trades, positions } = useData();
  const { quoteMap } = useQuotes();
  const isMobile = useWindowWidth() < 600;

  const HIDDEN_ON_MOBILE = new Set(["lastActivity", "cycles", "health"]);
  const visibleCols = isMobile ? COL_DEFS.filter((c) => !HIDDEN_ON_MOBILE.has(c.key)) : COL_DEFS;

  const [lifespans, setLifespans] = useState([]);
  const [lifespanLoading, setLifespanLoading] = useState(true);
  const [lifespanError,   setLifespanError]   = useState(null);

  const [search,  setSearch]  = useState("");
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("desc");

  useEffect(() => {
    let cancelled = false;
    setLifespanLoading(true);
    setLifespanError(null);

    fetch("/api/position-lifespan")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.ok) setLifespans(json.lifespans ?? []);
        else setLifespanError(json.error || "Unknown error");
      })
      .catch((err) => { if (!cancelled) setLifespanError(err.message); })
      .finally(() => { if (!cancelled) setLifespanLoading(false); });

    return () => { cancelled = true; };
  }, []);

  const directory = useMemo(
    () => buildTickerDirectory({ trades, positions, lifespans }),
    [trades, positions, lifespans]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const subset = q
      ? directory.filter((r) => r.ticker.toLowerCase().startsWith(q))
      : directory;
    if (!sortKey) return subset;
    return [...subset].sort((a, b) => compareRows(a, b, sortKey, sortDir));
  }, [directory, search, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div style={{
      padding: theme.space[5], background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: theme.space[3], marginBottom: theme.space[3],
      }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tickers…"
          style={{
            padding: `${theme.space[1]}px ${theme.space[3]}px`,
            background: theme.bg.elevated,
            border: `1px solid ${theme.border.default}`,
            borderRadius: theme.radius.sm,
            color: theme.text.primary,
            fontFamily: "inherit", fontSize: theme.size.sm,
            minWidth: 200,
          }}
        />
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>
          {filtered.length} ticker{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      {!isMobile && lifespanError && (
        <div style={{
          padding: theme.space[2], marginBottom: theme.space[3],
          fontSize: theme.size.xs, color: theme.amber,
          background: `${theme.amber}1a`, border: `1px solid ${theme.amber}55`,
          borderRadius: theme.radius.sm,
        }}>
          Cycle counts unavailable: {lifespanError}
        </div>
      )}

      {directory.length === 0 ? (
        <div style={{ color: theme.text.muted, fontSize: theme.size.sm, padding: theme.space[3] }}>
          No tickers traded yet.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
              {visibleCols.map((c) => {
                const isActive = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    onClick={() => handleSort(c.key)}
                    style={{
                      padding: `${theme.space[2]}px ${theme.space[2]}px`,
                      textAlign: c.align,
                      color: isActive ? theme.text.primary : theme.text.muted,
                      fontWeight: isActive ? 600 : 500,
                      fontSize: theme.size.xs,
                      textTransform: "uppercase", letterSpacing: "0.5px",
                      cursor: "pointer", userSelect: "none",
                    }}
                  >
                    {c.label}
                    <span style={{ marginLeft: 4, opacity: isActive ? 0.8 : 0.25, fontSize: theme.size.xs }}>
                      {isActive ? (sortDir === "desc" ? "▼" : "▲") : "⇅"}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.ticker} style={{
                borderBottom: `1px solid ${theme.border.default}`,
                borderLeft: row.hasOpenPositions ? `3px solid ${theme.green}` : "3px solid transparent",
              }}>
                <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px` }}>
                  <button
                    onClick={() => onOpenTickerDetail?.(row.ticker)}
                    style={{
                      background: "transparent", border: "none", padding: 0,
                      color: theme.text.primary, fontFamily: "inherit",
                      fontSize: theme.size.sm, fontWeight: 700,
                      cursor: onOpenTickerDetail ? "pointer" : "default",
                    }}
                    onMouseEnter={(e) => { if (onOpenTickerDetail) e.currentTarget.style.color = theme.blue; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = theme.text.primary; }}
                  >
                    {row.ticker}
                  </button>
                </td>
                <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.sm }}>
                  <StatusCell status={row.status} />
                </td>
                {!isMobile && (
                  <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.sm, color: theme.text.muted }}>
                    {row.lastActivity ? formatExpiry(row.lastActivity) : "—"}
                  </td>
                )}
                {!isMobile && (
                  <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.sm, textAlign: "right", color: theme.text.primary }}>
                    <CyclesCell row={row} lifespanLoading={lifespanLoading} lifespanError={lifespanError} />
                  </td>
                )}
                <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.sm, textAlign: "right" }}>
                  <PnlCell value={row.lifetimePnl} includesSuspect={row.includesSuspect} />
                </td>
                <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.sm, textAlign: "right", color: row.capital === 0 ? theme.text.muted : theme.text.primary }}>
                  {row.capital === 0 ? "$0" : formatDollars(row.capital)}
                </td>
                {!isMobile && (
                  <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.sm }}>
                    <HealthCell ticker={row.ticker} positions={positions} quoteMap={quoteMap} hasOpenPositions={row.hasOpenPositions} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
