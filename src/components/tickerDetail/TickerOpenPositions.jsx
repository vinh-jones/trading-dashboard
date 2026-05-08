import { theme } from "../../lib/theme";
import { TYPE_COLORS } from "../../lib/constants";
import { useWindowWidth } from "../../hooks/useWindowWidth";
import { useQuotes } from "../../hooks/useQuotes";
import { calcDTE, buildOccSymbol } from "../../lib/trading";
import { formatDollars, formatDollarsFull, formatExpiry } from "../../lib/format";
import { shortOptionGlDollars, leapGlDollars } from "../../lib/positionMetrics";

function TypeBadge({ type }) {
  const c = TYPE_COLORS[type] || { bg: theme.bg.elevated, border: theme.border.strong, text: theme.text.primary };
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px",
      fontSize: theme.size.xs, fontWeight: 600,
      background: c.bg, color: c.text,
      border: `1px solid ${c.border}`, borderRadius: theme.radius.sm,
      letterSpacing: "0.05em",
    }}>{type}</span>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", justifyContent: "space-between",
      marginBottom: theme.space[3],
    }}>
      <div style={{
        fontSize: theme.size.md, color: theme.text.muted,
        textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500,
      }}>{children}</div>
      {right && <div style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>{right}</div>}
    </div>
  );
}

function Row({ cells }) {
  return (
    <tr style={{ borderBottom: `1px solid ${theme.border.default}` }}>
      {cells.map((c, i) => (
        <td key={i} style={{
          padding: `${theme.space[2]}px ${theme.space[2]}px`,
          textAlign: c.align || "left",
          color: c.color || theme.text.primary,
          fontWeight: c.bold ? 600 : 400,
          fontSize: theme.size.sm,
          whiteSpace: "nowrap",
        }}>{c.value}</td>
      ))}
    </tr>
  );
}

function pnlColor(pnl) {
  if (pnl == null) return theme.text.muted;
  return pnl >= 0 ? theme.green : theme.red;
}

export function TickerOpenPositions({ data }) {
  const isMobile = useWindowWidth() < 600;
  const { quoteMap } = useQuotes();
  const { openPositions, lifespans, ticker } = data;
  const csps   = openPositions?.csps   ?? [];
  const shares = openPositions?.shares ?? [];
  const leaps  = openPositions?.leaps  ?? [];
  const liveCount = csps.length + shares.length + leaps.length;

  if (liveCount === 0) {
    const last = lifespans?.[0];
    return (
      <div style={{
        padding: theme.space[5], background: theme.bg.surface,
        border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
        marginBottom: theme.space[4],
      }}>
        <SectionTitle right="none">Open Positions</SectionTitle>
        <div style={{ color: theme.text.muted, fontSize: theme.size.sm }}>
          No active positions on {ticker}.{" "}
          {last?.exit_date && <span>Last activity {last.exit_date}.</span>}
        </div>
      </div>
    );
  }

  const stockLast = data.quote?.last ?? data.quote?.mid ?? null;
  const otmCspPct = (strike) => stockLast != null && strike != null ? ((stockLast - strike) / strike) * 100 : null;
  const otmCcPct  = (strike) => stockLast != null && strike != null ? ((strike - stockLast) / stockLast) * 100 : null;
  const otmCell   = (pct) => pct == null
    ? { value: "—", align: "right", color: theme.text.muted }
    : { value: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, align: "right", color: pct >= 0 ? theme.green : theme.red, bold: true };

  // Active lifespan provides authoritative shareCount and blendedBasis
  const activeLifespan = lifespans?.find((l) => l.lifespan_status === "active");
  const totalShares = activeLifespan?.total_shares_at_peak ?? 0;
  const blended = activeLifespan?.blended_cost_basis ?? null;

  const rows = [];

  for (const sh of shares) {
    const lots = sh.positions?.length ?? 0;
    rows.push({
      cells: [
        { value: <TypeBadge type="Shares" /> },
        { value: "—", color: theme.text.muted, align: "right" },
        { value: "—", color: theme.text.muted },
        { value: "—", color: theme.text.muted, align: "right" },
        { value: totalShares, color: theme.text.primary, bold: true, align: "right" },
        { value: "—", color: theme.text.muted, align: "right" },
        { value: blended != null ? `blended cost basis $${blended.toFixed(2)} · ${lots} lot${lots === 1 ? "" : "s"}` : "", color: theme.text.muted },
        { value: "—", color: theme.text.muted, align: "right" },
        { value: "—", color: theme.text.muted, align: "right" },
      ],
    });

    if (sh.active_cc) {
      const cc = sh.active_cc;
      const dte = calcDTE(cc.expiry_date);
      const sym = buildOccSymbol(cc.ticker ?? sh.ticker, cc.expiry_date, true, cc.strike);
      const mid = quoteMap.get(sym)?.mid ?? null;
      const pnl = shortOptionGlDollars({
        premiumCollected: cc.premium_collected,
        optionMid: mid,
        contracts: cc.contracts,
      });
      rows.push({
        cells: [
          { value: <TypeBadge type="CC" /> },
          { value: `$${cc.strike}`, align: "right" },
          { value: formatExpiry(cc.expiry_date), color: theme.text.muted },
          { value: dte != null ? `${dte}d` : "—", align: "right", color: dte != null && dte <= 5 ? theme.red : theme.text.muted },
          { value: cc.contracts ?? 1, align: "right" },
          otmCell(otmCcPct(cc.strike)),
          { value: cc.notes ?? "", color: theme.text.muted },
          { value: formatDollarsFull(cc.premium_collected), color: theme.green, align: "right" },
          { value: pnl == null ? "—" : formatDollars(pnl), color: pnlColor(pnl), bold: true, align: "right" },
        ],
      });
    }
  }

  for (const csp of csps) {
    const dte = calcDTE(csp.expiry_date);
    const sym = buildOccSymbol(csp.ticker, csp.expiry_date, false, csp.strike);
    const mid = quoteMap.get(sym)?.mid ?? null;
    const pnl = shortOptionGlDollars({
      premiumCollected: csp.premium_collected,
      optionMid: mid,
      contracts: csp.contracts,
    });
    rows.push({
      cells: [
        { value: <TypeBadge type="CSP" /> },
        { value: `$${csp.strike}`, align: "right" },
        { value: formatExpiry(csp.expiry_date), color: theme.text.muted },
        { value: dte != null ? `${dte}d` : "—", align: "right", color: dte != null && dte <= 5 ? theme.red : theme.text.muted },
        { value: csp.contracts ?? 1, align: "right" },
        otmCell(otmCspPct(csp.strike)),
        { value: csp.notes ?? "", color: theme.text.muted },
        { value: formatDollarsFull(csp.premium_collected), color: theme.green, align: "right" },
        { value: pnl == null ? "—" : formatDollars(pnl), color: pnlColor(pnl), bold: true, align: "right" },
      ],
    });
  }

  for (const lp of leaps) {
    const dte = calcDTE(lp.expiry_date);
    const sym = buildOccSymbol(lp.ticker, lp.expiry_date, true, lp.strike);
    const mid = quoteMap.get(sym)?.mid ?? null;
    const pnl = leapGlDollars({
      capitalFronted: lp.capital_fronted,
      optionMid: mid,
      contracts: lp.contracts,
    });
    rows.push({
      cells: [
        { value: <TypeBadge type="LEAPS" /> },
        { value: `$${lp.strike}`, align: "right" },
        { value: formatExpiry(lp.expiry_date), color: theme.text.muted },
        { value: dte != null ? `${dte}d` : "—", align: "right" },
        { value: lp.contracts ?? 1, align: "right" },
        { value: "—", align: "right" },
        { value: lp.notes ?? "", color: theme.text.muted },
        { value: formatDollarsFull(lp.capital_fronted), color: theme.chart.leaps, align: "right" },
        { value: pnl == null ? "—" : formatDollars(pnl), color: pnlColor(pnl), bold: true, align: "right" },
      ],
    });
  }

  return (
    <div style={{
      padding: theme.space[5], background: theme.bg.surface,
      border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
      marginBottom: theme.space[4],
    }}>
      <SectionTitle right={`${liveCount} live`}>Open Positions</SectionTitle>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
            {(isMobile
              ? ["TYPE", "STRIKE", "DTE", "P&L"]
              : ["TYPE", "STRIKE", "EXPIRY", "DTE", "QTY", "% OTM", "NOTE", "PREMIUM", "P&L"]
            ).map((h) => (
              <th key={h} style={{
                padding: `${theme.space[2]}px ${theme.space[2]}px`,
                textAlign: ["STRIKE", "DTE", "QTY", "% OTM", "PREMIUM", "P&L"].includes(h) ? "right" : "left",
                color: theme.text.muted, fontWeight: 500,
                fontSize: theme.size.xs, textTransform: "uppercase", letterSpacing: "0.5px",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const MOBILE_KEEP = new Set([0, 1, 3, 8]); // TYPE, STRIKE, DTE, P&L
            const visibleCells = isMobile
              ? r.cells.filter((_, idx) => MOBILE_KEEP.has(idx))
              : r.cells;
            return <Row key={i} cells={visibleCells} />;
          })}
        </tbody>
      </table>
    </div>
  );
}
