import { useState } from "react";
import { T } from "../../theme.js";
import { Frame, TypeTag, Empty } from "../../primitives.jsx";
import { calcDTE, buildOccSymbol } from "../../../lib/trading.js";
import { targetProfitPctForDtePct, proximityFraction } from "../../../lib/positionAttention.js";

// Normalize the app's positions shape into the flat array the matrix expects.
export function normalizePositions(positions, quoteMap = new Map(), focusItems = []) {
  const rows = [];

  const addRows = (list, type) => {
    (list || []).forEach(pos => {
      const dte = calcDTE(pos.expiry_date);
      // dtePct: fraction of total duration remaining
      let dtePct = null;
      if (pos.open_date && pos.expiry_date && dte != null) {
        const openMs   = new Date(pos.open_date   + "T00:00:00").getTime();
        const expiryMs = new Date(pos.expiry_date + "T00:00:00").getTime();
        const totalDays = Math.max(1, Math.round((expiryMs - openMs) / 86400000));
        dtePct = totalDays > 0 ? Math.round((dte / totalDays) * 100) : null;
      }
      const targetPct = targetProfitPctForDtePct(dtePct);

      // G/L from focus items if available
      const posItems = (focusItems || []).filter(it => it.ticker === pos.ticker && it.type === type);
      const topAlert = posItems[0] ?? null;
      const priority = topAlert?.priority ?? null;

      // Approximate glPct from quoteMap if possible — fall back to null
      let glPct = null;
      if (pos.premium_collected && pos.strike && pos.expiry_date && pos.contracts) {
        try {
          const isCC = type === "CC";
          const sym = buildOccSymbol(pos.ticker, pos.expiry_date, isCC, pos.strike);
          const q = quoteMap.get(sym);
          if (q?.mid != null) {
            const glDollars = pos.premium_collected - (q.mid * pos.contracts * 100);
            glPct = Math.round((glDollars / pos.premium_collected) * 100);
          }
        } catch (_) {}
      }

      rows.push({
        id: `${pos.ticker}-${type}-${pos.expiry_date}-${pos.strike}`,
        ticker: pos.ticker,
        type,
        strike: pos.strike,
        dte: dte ?? "—",
        dtePct,
        glPct,
        gl: pos.premium_collected && glPct != null ? Math.round(pos.premium_collected * glPct / 100) : null,
        targetPct,
        priority,
        alerts: posItems.map(it => ({ priority: it.priority, title: it.message || it.rule || "" })),
      });
    });
  };

  addRows(positions.open_csps,       "CSP");
  addRows(positions.assigned_shares, "CC");  // CC shares
  addRows(positions.open_leaps,      "LEAPS");
  addRows(positions.open_spreads,    "Spread");

  // Sort: P1 first, then P2, then by DTE ascending
  const rank = { P1: 0, P2: 1, P3: 2, null: 3 };
  rows.sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) || (a.dte || 999) - (b.dte || 999));

  return rows;
}

const FILTERS = ["ALL", "CSP", "CC", "LEAPS"];

export function PositionsMatrix({ positions, focusItems, quoteMap }) {
  const [filter, setFilter] = useState("ALL");
  const rows = normalizePositions(positions, quoteMap, focusItems);
  const visible = filter === "ALL" ? rows : rows.filter(r => r.type === filter);

  if (rows.length === 0) {
    return (
      <Frame accent="focus" title="POSITIONS" subtitle="no open positions">
        <Empty
          glyph="○" accent="focus"
          title="No open positions."
          body="Your first CSP or CC will appear here with live DTE, proximity bar, and alert tags."
          compact
        />
      </Frame>
    );
  }

  return (
    <Frame
      accent="focus"
      title="POSITIONS"
      subtitle={`${rows.length} open · sorted by urgency`}
      right={
        <div style={{ display: "flex", gap: 4 }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              border: `1px solid ${filter === f ? T.blue : T.bd}`,
              background: filter === f ? T.blue + "18" : "transparent",
              color: filter === f ? T.blue : T.tm,
              padding: "3px 9px", fontSize: T.xs, letterSpacing: "0.1em",
              borderRadius: T.rSm, cursor: "pointer", fontFamily: T.mono,
            }}>{f}</button>
          ))}
        </div>
      }
    >
      {/* Column header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "46px 1fr 52px 56px 72px 72px 78px",
        gap: 10, padding: "4px 2px 6px",
        fontSize: T.xs, letterSpacing: "0.15em", color: T.tf,
        borderBottom: `1px solid ${T.bd}`,
      }}>
        <span>TKR</span>
        <span>ALERT</span>
        <span>TYPE</span>
        <span style={{ textAlign: "right" }}>STRIKE</span>
        <span style={{ textAlign: "right" }}>DTE</span>
        <span style={{ textAlign: "right" }}>G/L</span>
        <span style={{ textAlign: "right" }}>TARGET</span>
      </div>

      {visible.length === 0 ? (
        <div style={{ padding: "20px 8px", fontSize: T.sm, color: T.tf, textAlign: "center", fontStyle: "italic" }}>
          no {filter} positions ·{" "}
          <span onClick={() => setFilter("ALL")} style={{ color: T.blue, cursor: "pointer", textDecoration: "underline" }}>
            clear filter
          </span>
        </div>
      ) : (
        visible.map(p => <PositionRow key={p.id} p={p} />)
      )}
    </Frame>
  );
}

function PositionRow({ p }) {
  const [hover, setHover] = useState(false);
  const topAlert = p.alerts?.[0];
  const priColor = !topAlert ? "transparent" : topAlert.priority === "P1" ? T.red : T.amber;
  const glColor = p.gl == null ? T.tm : p.gl >= 0 ? T.green : T.red;
  const proximity = proximityFraction(p.glPct, p.targetPct);
  const proxColor = proximity >= 1 ? T.green : proximity >= 0.7 ? T.amber : T.blueB;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "46px 1fr 52px 56px 72px 72px 78px",
        gap: 10, alignItems: "center",
        padding: "9px 2px",
        borderBottom: `1px solid ${T.hair}`,
        background: hover ? T.elev + "80" : "transparent",
        borderLeft: `2px solid ${priColor}`,
        paddingLeft: 6,
        transition: "background 0.12s",
        cursor: "default",
      }}
    >
      <span style={{ fontSize: T.md, fontWeight: 600, color: T.t1 }}>{p.ticker}</span>

      <div style={{ minWidth: 0 }}>
        {topAlert ? (
          <div style={{ fontSize: T.sm, color: priColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {topAlert.title}
            {p.alerts.length > 1 && <span style={{ color: T.tf, marginLeft: 6 }}>+{p.alerts.length - 1}</span>}
          </div>
        ) : (
          <div style={{ fontSize: T.sm, color: T.ts }}>—</div>
        )}
      </div>

      <TypeTag t={p.type} />

      <span style={{ fontSize: T.sm, color: T.t2, textAlign: "right", fontFamily: T.mono }}>
        {p.strike ? `$${p.strike}` : "—"}
      </span>

      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: T.sm, color: T.t2, fontFamily: T.mono }}>{p.dte !== "—" ? `${p.dte}d` : "—"}</div>
        {p.dtePct != null && (
          <div style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono, marginTop: 1 }}>{p.dtePct}% left</div>
        )}
      </div>

      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: T.md, fontWeight: 600, color: glColor, fontFamily: T.mono, letterSpacing: "-0.02em" }}>
          {p.gl != null ? `${p.gl >= 0 ? "+" : ""}$${Math.abs(p.gl).toLocaleString()}` : "—"}
        </div>
        {p.glPct != null && (
          <div style={{ fontSize: T.xs, color: T.ts, fontFamily: T.mono, marginTop: 1 }}>
            {p.glPct >= 0 ? "+" : ""}{p.glPct}%
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
        {p.targetPct != null ? (
          <>
            <span style={{ fontSize: T.xs, color: T.ts, fontFamily: T.mono }}>
              <span style={{ color: proxColor }}>{Math.round(proximity * 100)}</span>
              <span style={{ color: T.tf }}>/{p.targetPct}%</span>
            </span>
            <div style={{ width: 70, height: 3, background: T.bd, borderRadius: 1, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, proximity * 100)}%`, background: proxColor }} />
            </div>
          </>
        ) : <span style={{ fontSize: T.xs, color: T.tf }}>—</span>}
      </div>
    </div>
  );
}
