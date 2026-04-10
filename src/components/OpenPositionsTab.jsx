import { useData } from "../hooks/useData";
import { useWindowWidth } from "../hooks/useWindowWidth";
import { formatDollars, formatDollarsFull, formatExpiry } from "../lib/format";
import { calcDTE, allocColor } from "../lib/trading";
import { TYPE_COLORS, SUBTYPE_LABELS } from "../lib/constants";
import { SixtyCheck } from "./SixtyCheck";
import { theme } from "../lib/theme";

export function OpenPositionsTab() {
  const { positions, account } = useData();
  const isMobile = useWindowWidth() < 600;
  const { assigned_shares, open_csps, open_leaps } = positions;

  // Collect ALL open LEAPS: standalone ones + those nested inside assigned shares cards
  const allOpenLeaps = [
    ...open_leaps,
    ...assigned_shares.flatMap(pos => pos.open_leaps ?? []),
  ];

  // ── Per-ticker allocation breakdown — drives the chart at the top ──
  const accountValue = account?.account_value || 1;
  const allocMap = {};
  open_csps.forEach(p => {
    if (!allocMap[p.ticker]) allocMap[p.ticker] = { csp: 0, shares: 0, leaps: 0 };
    allocMap[p.ticker].csp += (p.capital_fronted || 0);
  });
  assigned_shares.forEach(s => {
    const sharesTotal = s.positions.reduce((sum, lot) => sum + (lot.fronted || 0), 0);
    const leapsTotal  = (s.open_leaps ?? []).reduce((sum, l) => sum + (l.capital_fronted || 0), 0);
    if (!allocMap[s.ticker]) allocMap[s.ticker] = { csp: 0, shares: 0, leaps: 0 };
    allocMap[s.ticker].shares += sharesTotal;
    allocMap[s.ticker].leaps  += leapsTotal;
  });
  open_leaps.forEach(l => {
    if (!allocMap[l.ticker]) allocMap[l.ticker] = { csp: 0, shares: 0, leaps: 0 };
    allocMap[l.ticker].leaps += (l.capital_fronted || 0);
  });
  const allocRows = Object.entries(allocMap)
    .map(([ticker, { csp, shares, leaps }]) => ({
      ticker,
      cspPct:    csp    / accountValue,
      sharesPct: shares / accountValue,
      leapsPct:  leaps  / accountValue,
      totalPct:  (csp + shares + leaps) / accountValue,
    }))
    .sort((a, b) => b.totalPct - a.totalPct);
  const SCALE = Math.max(allocRows[0]?.totalPct ?? 0.20, 0.20); // scale to largest bar, min 20%

  const sectionHeader = (title) => (
    <div style={{ fontSize: theme.size.md, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500, marginBottom: 14 }}>
      {title}
    </div>
  );

  const panel = (children, style = {}) => (
    <div style={{ padding: "20px", background: theme.bg.surface, borderRadius: theme.radius.md, border: `1px solid ${theme.border.default}`, marginBottom: 16, ...style }}>
      {children}
    </div>
  );

  return (
    <div>
      {/* ── Allocation Chart ── */}
      {panel(
        <>
          {sectionHeader("Portfolio Allocation by Ticker")}
          <div>
            {allocRows.map((row) => {
              const sharesW = (row.sharesPct / SCALE) * 100;
              const leapsW  = (row.leapsPct  / SCALE) * 100;
              const cspW    = (row.cspPct    / SCALE) * 100;
              return (
                <div key={row.ticker} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                  <div style={{ width: 52, fontSize: theme.size.sm, fontWeight: 700, color: theme.text.primary, textAlign: "right", flexShrink: 0 }}>
                    {row.ticker}
                  </div>
                  <div style={{ flex: 1, height: 16, background: theme.border.default, borderRadius: 2, position: "relative" }}>
                    {row.sharesPct > 0 && <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${sharesW}%`, background: theme.chart.shares, borderRadius: "2px 0 0 2px" }} />}
                    {row.leapsPct  > 0 && <div style={{ position: "absolute", left: `${sharesW}%`, top: 0, height: "100%", width: `${leapsW}%`, background: theme.chart.leaps }} />}
                    {row.cspPct    > 0 && <div style={{ position: "absolute", left: `${sharesW + leapsW}%`, top: 0, height: "100%", width: `${cspW}%`, background: theme.blue, borderRadius: "0 2px 2px 0" }} />}
                    {/* Threshold reference lines */}
                    <div style={{ position: "absolute", left: `${(0.10 / SCALE) * 100}%`, top: -3, bottom: -3, width: 1, background: theme.text.muted, opacity: 0.8, zIndex: 2 }} />
                    <div style={{ position: "absolute", left: `${(0.15 / SCALE) * 100}%`, top: -3, bottom: -3, width: 1, background: theme.red, opacity: 0.8, zIndex: 2 }} />
                  </div>
                  <div style={{ width: 42, fontSize: theme.size.sm, fontWeight: 600, color: allocColor(row.totalPct), textAlign: "right", flexShrink: 0 }}>
                    {(row.totalPct * 100).toFixed(1)}%
                  </div>
                </div>
              );
            })}
            {/* Legend */}
            <div style={{ display: "flex", gap: 16, marginTop: 14, paddingLeft: 62, fontSize: theme.size.xs, color: theme.text.subtle }}>
              <span><span style={{ color: theme.chart.shares }}>■</span> Shares</span>
              <span><span style={{ color: theme.chart.leaps }}>■</span> LEAPS</span>
              <span><span style={{ color: theme.blue }}>■</span> CSP</span>
              <span style={{ marginLeft: 8 }}><span style={{ color: theme.text.muted }}>│</span> 10%</span>
              <span><span style={{ color: theme.red }}>│</span> 15%</span>
            </div>
          </div>
        </>
      )}

      {/* ── Open CSPs ── */}
      {panel(
        <>
          {sectionHeader(`Open Cash-Secured Puts (${open_csps.length})`)}
          {isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {open_csps.map((csp, i) => {
                const dte = calcDTE(csp.expiry_date);
                let dtePct = null;
                if (csp.open_date && csp.expiry_date && dte != null) {
                  const totalDays = Math.ceil(
                    (new Date(csp.expiry_date + "T00:00:00") - new Date(csp.open_date + "T00:00:00")) / 86400000
                  );
                  dtePct = totalDays > 0 ? (dte / totalDays) * 100 : 0;
                }
                const dtePctColor = dtePct == null ? theme.text.muted
                  : dtePct >= 60 ? theme.green
                  : dtePct >= 20 ? theme.amber
                  : theme.red;
                return (
                  <div key={i} style={{ background: theme.bg.surface, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm, padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, color: theme.text.primary, fontSize: theme.size.md }}>{csp.ticker}</span>
                        <span style={{ color: theme.text.primary, fontSize: theme.size.md }}>${csp.strike}</span>
                        <span style={{ color: theme.text.muted, fontSize: theme.size.sm }}>{formatExpiry(csp.expiry_date)}</span>
                      </div>
                      <span style={{ fontWeight: 600, color: theme.green, fontSize: theme.size.md }}>{formatDollarsFull(csp.premium_collected)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: theme.size.sm, flexWrap: "wrap" }}>
                      <span style={{ color: dte != null && dte <= 5 ? theme.red : theme.text.muted, fontWeight: dte != null && dte <= 5 ? 600 : 400 }}>
                        {dte != null ? `${dte}d` : "—"}
                      </span>
                      {dtePct != null && <span style={{ color: dtePctColor, fontWeight: 600 }}>{dtePct.toFixed(0)}% DTE left</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.md }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
                    {["Ticker", "Strike", "Expiry", "DTE", "% DTE Left", "Premium", "Capital", "ROI"].map((h) => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: theme.text.muted, fontWeight: 500, fontSize: theme.size.sm, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {open_csps.map((csp, i) => {
                    const dte = calcDTE(csp.expiry_date);
                    const roi = csp.capital_fronted ? ((csp.premium_collected / csp.capital_fronted) * 100).toFixed(2) : null;

                    // % DTE remaining = (expiry - today) / (expiry - open_date)
                    let dtePct = null;
                    if (csp.open_date && csp.expiry_date && dte != null) {
                      const totalDays = Math.ceil(
                        (new Date(csp.expiry_date + "T00:00:00") - new Date(csp.open_date + "T00:00:00")) / 86400000
                      );
                      dtePct = totalDays > 0 ? (dte / totalDays) * 100 : 0;
                    }
                    // Green ≥ 60% (plenty of time), yellow 20–59% (watch it), red < 20% (near expiry)
                    const dtePctColor = dtePct == null ? theme.text.muted
                      : dtePct >= 60 ? theme.green
                      : dtePct >= 20 ? theme.amber
                      : theme.red;

                    return (
                      <tr key={i} style={{ borderBottom: `1px solid ${theme.border.default}` }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#1a3a5c22")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <td style={{ padding: "9px 10px", fontWeight: 700, color: theme.text.primary }}>{csp.ticker}</td>
                        <td style={{ padding: "9px 10px", color: theme.text.primary }}>${csp.strike}</td>
                        <td style={{ padding: "9px 10px", color: theme.text.muted }}>{formatExpiry(csp.expiry_date)}</td>
                        <td style={{ padding: "9px 10px", color: dte != null && dte <= 5 ? theme.red : theme.text.muted, fontWeight: dte != null && dte <= 5 ? 600 : 400 }}>
                          {dte != null ? `${dte}d` : "—"}
                        </td>
                        <td style={{ padding: "9px 10px", fontWeight: 600, color: dtePctColor }}>
                          {dtePct != null ? `${dtePct.toFixed(0)}%` : "—"}
                        </td>
                        <td style={{ padding: "9px 10px", color: theme.green, fontWeight: 600 }}>{formatDollarsFull(csp.premium_collected)}</td>
                        <td style={{ padding: "9px 10px", color: theme.text.muted }}>{formatDollarsFull(csp.capital_fronted)}</td>
                        <td style={{ padding: "9px 10px", color: theme.blue, fontWeight: 500 }}>{roi ? `${roi}%` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Assigned Shares ── */}
      {panel(
        <>
          {sectionHeader(`Assigned Shares (${assigned_shares.length} tickers)`)}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
            {assigned_shares.map((pos) => {
              const cc  = pos.active_cc;
              const dte = cc ? calcDTE(cc.expiry_date) : null;

              return (
                <div key={pos.ticker} style={{ background: theme.bg.base, borderRadius: theme.radius.sm, border: `1px solid ${theme.border.default}`, padding: "16px" }}>
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                    <span style={{ fontSize: theme.size.lg, fontWeight: 700, color: theme.text.primary }}>{pos.ticker}</span>
                    <span style={{ fontSize: theme.size.md, color: theme.text.muted }}>
                      Cost basis: <span style={{ color: theme.text.primary, fontWeight: 600 }}>{formatDollarsFull(pos.cost_basis_total)}</span>
                    </span>
                  </div>

                  {/* Lots */}
                  <div style={{ marginBottom: 10 }}>
                    {pos.positions.map((p, i) => (
                      <div key={i} style={{ fontSize: theme.size.sm, color: theme.text.subtle, marginBottom: 2 }}>
                        {p.description} — {formatDollarsFull(p.fronted)}
                      </div>
                    ))}
                  </div>

                  {/* Active CC */}
                  {cc ? (
                    <div style={{ padding: "10px 12px", background: "#1a4a3a", border: "1px solid #2a6a5a", borderRadius: theme.radius.sm }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: theme.size.sm, color: "#6dd9a0", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Active CC</span>
                        <span style={{ fontSize: theme.size.sm, color: dte != null && dte <= 3 ? theme.red : theme.text.muted }}>
                          {dte != null ? `${dte}d DTE` : "—"} · exp {formatExpiry(cc.expiry_date)}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 16 }}>
                        <div>
                          <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>Strike </span>
                          <span style={{ fontSize: theme.size.md, color: theme.text.primary, fontWeight: 600 }}>${cc.strike}</span>
                        </div>
                        <div>
                          <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>Contracts </span>
                          <span style={{ fontSize: theme.size.md, color: theme.text.primary, fontWeight: 600 }}>{cc.contracts}</span>
                        </div>
                        <div>
                          <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>Premium </span>
                          <span style={{ fontSize: theme.size.md, color: theme.green, fontWeight: 600 }}>{formatDollarsFull(cc.premium_collected)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: "8px 12px", background: "#3a1a1a", border: "1px solid #7c2a2a", borderRadius: theme.radius.sm, fontSize: theme.size.md, color: theme.red, fontWeight: 500 }}>
                      NO ACTIVE CC
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Open LEAPS ── */}
      {panel(
        <>
          {sectionHeader(`Open LEAPS (${allOpenLeaps.length})`)}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {allOpenLeaps.map((l, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 14px", background: "#2a1a3a", border: "1px solid #4a2a5c", borderRadius: theme.radius.sm }}>
                <div>
                  <span style={{ fontSize: theme.size.lg, fontWeight: 700, color: theme.text.primary, marginRight: 12 }}>{l.ticker}</span>
                  <span style={{ fontSize: theme.size.md, color: theme.chart.leaps }}>{l.description}</span>
                </div>
                <div style={{ fontSize: theme.size.sm, color: theme.text.muted }}>
                  Capital: <span style={{ color: theme.text.primary, fontWeight: 600 }}>{formatDollarsFull(l.capital_fronted)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── 60/60 Quick-Check ── */}
      <SixtyCheck />
    </div>
  );
}
