import { useState, useEffect, useMemo } from "react";
import { T } from "../../theme.js";
import { Frame, SectionLabel, Empty } from "../../primitives.jsx";
import { calcDTE, buildOccSymbol, parseShareCount } from "../../../lib/trading.js";
import { RadarSurface } from "./RadarSurface.jsx";
import { EarningsSurface } from "./EarningsSurface.jsx";

// Semantic color map for allocation bars — parallel to TYPE_COLORS intentional exception
const ALLOC_COLORS = { Shares: T.green, LEAPS: T.amber, CSP: T.blue };

// ── Data helpers ──────────────────────────────────────────────────────────────

function computeAllocations(positions, accountValue) {
  const acc = accountValue || 1;
  const map = new Map();

  const bump = (ticker, kind, val) => {
    if (!map.has(ticker)) map.set(ticker, { ticker, Shares: 0, LEAPS: 0, CSP: 0 });
    map.get(ticker)[kind] += val;
  };

  for (const p of positions.open_csps || []) {
    bump(p.ticker, "CSP", (p.strike || 0) * (p.contracts || 1) * 100);
  }
  for (const s of positions.assigned_shares || []) {
    bump(s.ticker, "Shares", s.cost_basis_total || 0);
    for (const l of s.open_leaps || []) {
      bump(l.ticker, "LEAPS", l.entry_cost || 0);
    }
  }
  for (const l of positions.open_leaps || []) {
    bump(l.ticker, "LEAPS", l.entry_cost || 0);
  }

  return [...map.values()]
    .map(r => {
      const total = r.Shares + r.LEAPS + r.CSP;
      return { ...r, total, pct: total / acc };
    })
    .sort((a, b) => b.total - a.total);
}

// ── Allocation widget ─────────────────────────────────────────────────────────

export function AllocationWidget({ positions, account }) {
  const accountValue = account?.account_value ?? 0;
  const rows = useMemo(() => computeAllocations(positions, accountValue), [positions, accountValue]);

  if (rows.length === 0) {
    return (
      <Frame accent="focus" title="PORTFOLIO ALLOCATION" subtitle="no positions">
        <Empty glyph="◻" accent="focus" compact title="No positions to allocate." body="Allocation bars appear once you have open CSPs, assigned shares, or LEAPS." />
      </Frame>
    );
  }

  const maxPct = Math.max(0.20, ...rows.map(r => r.pct));

  return (
    <Frame accent="focus" title="PORTFOLIO ALLOCATION"
      subtitle={`${rows.length} tickers · horizontal stacked · 10% / 15% concentration caps`}
      right={
        <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: T.xs, color: T.tm, fontFamily: T.mono }}>
          {Object.entries(ALLOC_COLORS).map(([k, c]) => (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 7, height: 7, background: c, display: "inline-block" }} />{k}
            </span>
          ))}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {rows.map(r => <AllocBar key={r.ticker} row={r} maxPct={maxPct} />)}
      </div>
    </Frame>
  );
}

function AllocBar({ row, maxPct }) {
  const widthPct = (row.pct / maxPct) * 100;
  const color = row.pct >= 0.15 ? T.red : row.pct >= 0.10 ? T.amber : T.t2;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "56px 1fr 56px", gap: 12, alignItems: "center",
      padding: "5px 0",
    }}>
      <span style={{ fontSize: T.sm, color: T.t1, fontFamily: T.mono, fontWeight: 600, textAlign: "right" }}>
        {row.ticker}
      </span>
      <div style={{ position: "relative", height: 12, background: T.bg }}>
        {/* 10% reference line */}
        <div style={{ position: "absolute", top: -2, bottom: -2, left: `${(0.10 / maxPct) * 100}%`, width: 1, background: T.amber, opacity: 0.5 }} />
        {/* 15% reference line */}
        <div style={{ position: "absolute", top: -2, bottom: -2, left: `${(0.15 / maxPct) * 100}%`, width: 1, background: T.red, opacity: 0.7 }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", width: `${widthPct}%`, overflow: "hidden" }}>
          {["Shares", "LEAPS", "CSP"].map(k => {
            if (!row[k]) return null;
            return <div key={k} style={{ width: `${(row[k] / row.total) * 100}%`, background: ALLOC_COLORS[k] }} />;
          })}
        </div>
      </div>
      <span style={{ fontSize: T.sm, color, fontFamily: T.mono, textAlign: "right", fontWeight: 600 }}>
        {(row.pct * 100).toFixed(1)}%
      </span>
    </div>
  );
}

// ── Open Positions table ──────────────────────────────────────────────────────

const CSP_COLS = [
  { k: "ticker",   label: "TKR",    w: "56px"  },
  { k: "strike",   label: "STRIKE", w: "60px",  r: true },
  { k: "dte",      label: "DTE",    w: "44px",  r: true },
  { k: "pctOtm",   label: "% OTM",  w: "64px",  r: true },
  { k: "delta",    label: "Δ",      w: "44px",  r: true },
  { k: "premium",  label: "PREM",   w: "68px",  r: true },
  { k: "glDollar", label: "P/L $",  w: "72px",  r: true },
  { k: "glPct",    label: "P/L %",  w: "56px",  r: true },
];

const CC_COLS = [
  { k: "ticker",   label: "TKR",     w: "56px"  },
  { k: "strike",   label: "STRIKE",  w: "60px",  r: true },
  { k: "dte",      label: "DTE",     w: "44px",  r: true },
  { k: "basis",    label: "BASIS",   w: "72px",  r: true },
  { k: "vsBasis",  label: "vs BASIS",w: "68px",  r: true },
  { k: "premium",  label: "PREM",    w: "68px",  r: true },
  { k: "glDollar", label: "P/L $",   w: "72px",  r: true },
  { k: "glPct",    label: "P/L %",   w: "56px",  r: true },
];

const LEAP_COLS = [
  { k: "ticker",   label: "TKR",     w: "56px"  },
  { k: "strike",   label: "STRIKE",  w: "60px",  r: true },
  { k: "expiry",   label: "EXPIRY",  w: "80px"  },
  { k: "dte",      label: "DTE",     w: "52px",  r: true },
  { k: "cost",     label: "COST",    w: "72px",  r: true },
];

export function OpenPositionsTable({ positions, quoteMap }) {
  const [view, setView] = useState("CSP");

  const csps  = positions?.open_csps || [];
  const ccs   = (positions?.assigned_shares || []).filter(s => s.active_cc).map(s => ({ ...s.active_cc, _basis: s.cost_basis_total }));
  const leaps = [
    ...(positions?.open_leaps || []),
    ...(positions?.assigned_shares || []).flatMap(s => s.open_leaps || []),
  ];

  const views = [
    { k: "CSP",  label: `CSPs (${csps.length})`,   color: T.blue  },
    { k: "CC",   label: `CCs (${ccs.length})`,     color: T.amber },
    { k: "LEAP", label: `LEAPs (${leaps.length})`, color: T.cyan  },
  ];

  const subtitle = view === "LEAP" ? "long-dated calls · position inventory" : "greeks + P/L";

  return (
    <Frame accent="focus" title="OPEN POSITIONS" subtitle={subtitle} right={
      <div style={{ display: "flex", gap: 4 }}>
        {views.map(v => (
          <button key={v.k} onClick={() => setView(v.k)} style={{
            border: `1px solid ${view === v.k ? v.color : T.bd}`,
            background: view === v.k ? v.color + "18" : "transparent",
            color: view === v.k ? v.color : T.tm,
            padding: "3px 10px", fontSize: T.xs, letterSpacing: "0.08em",
            fontFamily: T.mono, cursor: "pointer",
          }}>{v.label}</button>
        ))}
      </div>
    }>
      {view === "CSP"  && <PosTable rows={buildCspRows(csps, quoteMap)}  cols={CSP_COLS}  />}
      {view === "CC"   && <PosTable rows={buildCcRows(ccs, quoteMap)}    cols={CC_COLS}   />}
      {view === "LEAP" && <PosTable rows={buildLeapRows(leaps)}           cols={LEAP_COLS} />}
    </Frame>
  );
}

function calcGl(ticker, expiryDate, isCall, strike, contracts, premiumCollected, quoteMap) {
  if (!expiryDate || strike == null || !contracts || !premiumCollected || !quoteMap) return {};
  const sym = buildOccSymbol(ticker, expiryDate, isCall, strike);
  const mid = quoteMap.get?.(sym)?.mid;
  if (mid == null) return {};
  const glDollar = premiumCollected - mid * contracts * 100;
  const glPct    = (glDollar / premiumCollected) * 100;
  return { glDollar, glPct };
}

function buildCspRows(csps, quoteMap) {
  return csps.map(p => {
    const stockQ  = quoteMap?.get?.(p.ticker);
    const stockPx = stockQ?.last ?? stockQ?.mid ?? null;
    const rawOtm  = stockPx && p.strike ? (stockPx - p.strike) / p.strike * 100 : null;
    const { glDollar, glPct } = calcGl(p.ticker, p.expiry_date, false, p.strike, p.contracts, p.premium_collected, quoteMap);
    return {
      ticker:   p.ticker,
      strike:   p.strike ? `$${p.strike}` : "—",
      dte:      (() => { const d = calcDTE(p.expiry_date); return d != null ? `${d}d` : "—"; })(),
      pctOtm:   rawOtm != null ? `${rawOtm >= 0 ? "+" : ""}${rawOtm.toFixed(1)}%` : "—",
      delta:    p.delta != null ? p.delta.toFixed(2) : "—",
      premium:  p.premium_collected ? `$${p.premium_collected.toLocaleString()}` : "—",
      glDollar: glDollar != null ? `${glDollar >= 0 ? "+" : "−"}$${Math.abs(Math.round(glDollar))}` : "—",
      glPct:    glPct    != null ? `${glPct    >= 0 ? "+" : ""}${glPct.toFixed(0)}%` : "—",
      _glColor: glDollar != null ? (glDollar >= 0 ? T.green : T.red) : null,
    };
  });
}

function buildCcRows(ccs, quoteMap) {
  return ccs.map(p => {
    const basis = p._basis;
    const contracts = p.contracts || 1;
    const basisPerSh = basis && contracts ? basis / (contracts * 100) : null;
    const diff = basisPerSh && p.strike ? p.strike - basisPerSh : null;
    const diffColor = diff == null ? T.tm : diff >= 0 ? T.green : T.red;
    const { glDollar, glPct } = calcGl(p.ticker, p.expiry_date, true, p.strike, contracts, p.premium_collected, quoteMap);
    return {
      ticker:   p.ticker,
      strike:   p.strike ? `$${p.strike}` : "—",
      dte:      (() => { const d = calcDTE(p.expiry_date); return d != null ? `${d}d` : "—"; })(),
      basis:    basisPerSh ? `$${basisPerSh.toFixed(2)}/sh` : "—",
      vsBasis:  diff != null ? `${diff >= 0 ? "+" : ""}$${diff.toFixed(2)}` : "—",
      premium:  p.premium_collected ? `$${p.premium_collected.toLocaleString()}` : "—",
      glDollar: glDollar != null ? `${glDollar >= 0 ? "+" : "−"}$${Math.abs(Math.round(glDollar))}` : "—",
      glPct:    glPct    != null ? `${glPct    >= 0 ? "+" : ""}${glPct.toFixed(0)}%` : "—",
      _glColor: glDollar != null ? (glDollar >= 0 ? T.green : T.red) : null,
      _vsBasisColor: diffColor,
    };
  });
}

function buildLeapRows(leaps) {
  return leaps.map(l => ({
    ticker: l.ticker,
    strike: l.strike ? `$${l.strike}` : "—",
    expiry: l.expiry_date ? l.expiry_date.slice(5).replace("-", "/") : "—",
    dte:    (() => { const d = calcDTE(l.expiry_date); return d != null ? `${d}d` : "—"; })(),
    cost:   l.entry_cost ? `$${l.entry_cost.toLocaleString()}` : "—",
  }));
}

function PosTable({ rows, cols }) {
  const tpl = cols.map(c => c.w).join(" ");
  if (rows.length === 0) {
    return (
      <div style={{ padding: "12px 2px", fontSize: T.sm, color: T.tf, fontFamily: T.mono }}>
        No positions in this category.
      </div>
    );
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: cols.reduce((s, c) => s + parseInt(c.w) + 10, 0) + "px" }}>
        <div style={{
          display: "grid", gridTemplateColumns: tpl, gap: 10,
          padding: "4px 2px 6px", fontSize: T.xs, letterSpacing: "0.1em", color: T.tf,
          borderBottom: `1px solid ${T.bd}`, fontFamily: T.mono,
        }}>
          {cols.map(c => <span key={c.k} style={{ textAlign: c.r ? "right" : "left" }}>{c.label}</span>)}
        </div>
        {rows.map((row, i) => <PosRow key={i} row={row} cols={cols} tpl={tpl} />)}
      </div>
    </div>
  );
}

function PosRow({ row, cols, tpl }) {
  const [hover, setHover] = useState(false);
  const cellColor = (k) => {
    if (k === "ticker")                    return T.t1;
    if (k === "vsBasis")                   return row._vsBasisColor ?? T.t2;
    if (k === "glDollar" || k === "glPct") return row._glColor ?? T.t2;
    return T.t2;
  };
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "grid", gridTemplateColumns: tpl, gap: 10, alignItems: "center",
        padding: "7px 2px", borderBottom: `1px solid ${T.hair}`,
        background: hover ? T.elev + "80" : "transparent",
        fontFamily: T.mono, fontSize: T.sm,
      }}
    >
      {cols.map(c => (
        <span key={c.k} style={{
          textAlign: c.r ? "right" : "left",
          color: cellColor(c.k),
          fontWeight: c.k === "ticker" ? 600 : 400,
        }}>
          {row[c.k] ?? "—"}
        </span>
      ))}
    </div>
  );
}

// ── Assigned Shares ───────────────────────────────────────────────────────────

export function AssignedShares({ positions, quoteMap }) {
  const assigned = positions?.assigned_shares || [];

  const covered   = assigned.filter(s => s.active_cc != null);
  const uncovered = assigned.filter(s => s.active_cc == null);
  const total     = assigned.length;

  if (total === 0) return null;

  return (
    <Frame accent="quiet" title="ASSIGNED SHARES"
      subtitle={`${total} lots${uncovered.length ? ` · ${uncovered.length} uncovered` : ""} · roll analysis when CC below basis`}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
        {uncovered.map(s => <UncoveredCard key={s.ticker} s={s} quoteMap={quoteMap} />)}
        {covered.map(s => <AssignedCard key={s.ticker} s={s} quoteMap={quoteMap} />)}
      </div>
    </Frame>
  );
}

function UncoveredCard({ s, quoteMap }) {
  const basis      = s.cost_basis_total || 0;
  const shares     = (s.positions || []).reduce((sum, lot) => sum + parseShareCount(lot.description), 0);
  const costPerSh  = shares > 0 ? basis / shares : null;
  const stockQ     = quoteMap?.get?.(s.ticker);
  const nowPx      = stockQ?.last ?? stockQ?.mid ?? null;
  const unrealized = nowPx != null && costPerSh != null ? (nowPx - costPerSh) * shares : null;
  const plColor    = unrealized == null ? T.tm : unrealized >= 0 ? T.green : T.red;

  return (
    <div style={{
      padding: "12px 14px",
      border: `1px solid ${T.amber}`,
      borderLeft: `3px solid ${T.amber}`,
      background: T.amber + "08",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: T.md, fontWeight: 600, color: T.t1, fontFamily: T.mono }}>{s.ticker}</span>
        <span style={{ fontSize: T.xs, color: T.tm, fontFamily: T.mono }}>
          basis <span style={{ color: T.t1 }}>${basis.toLocaleString()}</span>
        </span>
      </div>
      <div style={{ fontSize: T.xs, color: T.tm, fontFamily: T.mono, marginTop: 2 }}>
        {shares > 0 && <span>{shares} sh · </span>}
        {costPerSh != null && <span>${costPerSh.toFixed(2)}/sh</span>}
        {nowPx != null && <span> · now <span style={{ color: T.t2 }}>${nowPx.toFixed(2)}</span></span>}
        {unrealized != null && (
          <span style={{ color: plColor }}> ({unrealized >= 0 ? "+" : ""}${Math.round(unrealized).toLocaleString()})</span>
        )}
      </div>
      <div style={{
        marginTop: 8, padding: "7px 10px",
        background: T.amber + "12", border: `1px dashed ${T.amber}`,
      }}>
        <span style={{ fontSize: T.xs, color: T.amber, fontFamily: T.mono, letterSpacing: "0.1em" }}>
          UNCOVERED — write a covered call
        </span>
      </div>
    </div>
  );
}

function AssignedCard({ s, quoteMap }) {
  const cc         = s.active_cc;
  const basis      = s.cost_basis_total || 0;
  const shares     = (s.positions || []).reduce((sum, lot) => sum + parseShareCount(lot.description), 0);
  const basisPerSh = shares > 0 ? basis / shares : cc ? basis / ((cc.contracts || 1) * 100) : null;
  const underBasis = basisPerSh && cc?.strike ? cc.strike < basisPerSh : false;
  const dte        = calcDTE(cc?.expiry_date);
  const ccVsBasis  = basisPerSh && cc?.strike ? cc.strike - basisPerSh : null;

  const stockQ     = quoteMap?.get?.(s.ticker);
  const nowPx      = stockQ?.last ?? stockQ?.mid ?? null;
  const unrealized = nowPx != null && basisPerSh != null ? (nowPx - basisPerSh) * (shares || (cc?.contracts || 1) * 100) : null;
  const plColor    = unrealized == null ? T.tm : unrealized >= 0 ? T.green : T.red;

  return (
    <div style={{
      padding: "12px 14px",
      border: `1px solid ${underBasis ? T.amber : T.bd}`,
      borderLeft: `3px solid ${underBasis ? T.amber : T.green}`,
      background: T.surf,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: T.md, fontWeight: 600, color: T.t1, fontFamily: T.mono }}>{s.ticker}</span>
        <span style={{ fontSize: T.xs, color: T.tm, fontFamily: T.mono }}>
          basis <span style={{ color: T.t1 }}>${basis.toLocaleString()}</span>
        </span>
      </div>
      <div style={{ fontSize: T.xs, color: T.tm, fontFamily: T.mono, marginTop: 2 }}>
        {shares > 0 && <span>{shares} sh · </span>}
        {basisPerSh != null && <span>${basisPerSh.toFixed(2)}/sh</span>}
        {nowPx != null && <span> · now <span style={{ color: T.t2 }}>${nowPx.toFixed(2)}</span></span>}
        {unrealized != null && (
          <span style={{ color: plColor }}> ({unrealized >= 0 ? "+" : ""}${Math.round(unrealized).toLocaleString()})</span>
        )}
      </div>
      <div style={{
        marginTop: 8, padding: "6px 10px",
        background: underBasis ? T.amber + "12" : T.green + "12",
        border: `1px solid ${underBasis ? T.amber + "55" : T.green + "55"}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: T.xs, color: underBasis ? T.amber : T.green, fontFamily: T.mono, letterSpacing: "0.1em" }}>
            ACTIVE CC
          </span>
          <span style={{ fontSize: T.xs, color: T.tm, fontFamily: T.mono }}>
            {dte != null ? `${dte}d` : "—"}
          </span>
        </div>
        <div style={{ fontSize: T.sm, color: T.t2, fontFamily: T.mono, marginTop: 2 }}>
          Strike <span style={{ color: T.t1 }}>${cc.strike}</span>
          {cc.premium_collected ? <> · prem <span style={{ color: T.green }}>${cc.premium_collected.toLocaleString()}</span></> : null}
        </div>
      </div>
      {ccVsBasis != null && (
        <div style={{ fontSize: T.xs, color: underBasis ? T.amber : T.ts, fontFamily: T.mono, marginTop: 8 }}>
          {underBasis
            ? `CC $${Math.abs(ccVsBasis).toFixed(2)}/sh below basis — consider rolling up`
            : `CC +$${ccVsBasis.toFixed(2)}/sh above basis — profitable if called`}
        </div>
      )}
    </div>
  );
}

// ── Main surface ──────────────────────────────────────────────────────────────

const EXPLORE_TABS = [
  { k: "portfolio", label: "Portfolio" },
  { k: "radar",     label: "Radar"     },
  { k: "earnings",  label: "Earnings"  },
];

const VALID_MODES = new Set(EXPLORE_TABS.map(t => t.k));

export function ExploreSurface({ positions, account, trades, quoteMap, marketContext }) {
  const [mode, setMode] = useState(() => {
    try { const s = localStorage.getItem("redesign-explore-mode"); return VALID_MODES.has(s) ? s : "portfolio"; }
    catch { return "portfolio"; }
  });

  const switchMode = (m) => {
    setMode(m);
    try { localStorage.setItem("redesign-explore-mode", m); } catch {}
  };

  useEffect(() => {
    const h = (e) => { if (VALID_MODES.has(e.detail)) switchMode(e.detail); };
    window.addEventListener("tw-explore-mode", h);
    return () => window.removeEventListener("tw-explore-mode", h);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Tab strip */}
      <div style={{ display: "flex", gap: 6 }}>
        {EXPLORE_TABS.map(t => {
          const active = t.k === mode;
          return (
            <button key={t.k} onClick={() => switchMode(t.k)} style={{
              padding: "5px 16px",
              border: `1px solid ${active ? T.green : T.bd}`,
              background: active ? T.green + "18" : "transparent",
              color: active ? T.green : T.tm,
              fontSize: T.sm, fontFamily: T.mono, letterSpacing: "0.06em",
              cursor: "pointer", borderRadius: T.rMd,
            }}>{t.label}</button>
          );
        })}
      </div>

      {mode === "portfolio" && <PortfolioView positions={positions} account={account} quoteMap={quoteMap} />}
      {mode === "radar"     && <RadarSurface positions={positions} account={account} marketContext={marketContext} />}
      {mode === "earnings"  && <EarningsSurface positions={positions} account={account} trades={trades} />}
    </div>
  );
}

function PortfolioView({ positions, account, quoteMap }) {
  const allPositions = [
    ...(positions?.open_csps || []),
    ...(positions?.assigned_shares || []),
    ...(positions?.open_leaps || []),
  ];

  if (allPositions.length === 0) {
    return (
      <Frame accent="focus" title="PORTFOLIO" subtitle="no positions">
        <Empty glyph="◻" accent="focus" compact
          title="Portfolio is empty."
          body="Allocation breakdowns, open positions, assigned shares, and LEAPS all render here once you have positions."
        />
      </Frame>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <AllocationWidget positions={positions} account={account} />
      <OpenPositionsTable positions={positions} quoteMap={quoteMap} />
      <AssignedShares positions={positions} quoteMap={quoteMap} />
    </div>
  );
}
