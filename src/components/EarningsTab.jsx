import { useEffect, useMemo, useState } from "react";
import { theme } from "../lib/theme";
import { supabase } from "../lib/supabase";
import {
  buildEarningsPaths,
  getUpcomingFridays,
  pickPreEarningsExpiry,
  pickEarningsWeekExpiry,
  daysBetween,
  scoreConvictionFactors,
  computeTickerConcentration,
  projectedConcentration,
  CONVICTION_PROMINENCE,
  computePortfolioBaseline,
  computeFamiliarity,
  computeDeploymentGate,
} from "../lib/earningsEngine";

const { size: sz, space: sp, radius: r, font, text, border, bg } = theme;

// ── Path accent colours ──────────────────────────────────────────────────────
const PATH_ACCENT = {
  A: theme.text.muted,
  B: theme.blue,
  C: theme.amber,
  D: theme.green,
};

const CONVICTIONS = [
  { k: "low",      label: "Low",      color: theme.blue  },
  { k: "standard", label: "Standard", color: theme.amber },
  { k: "high",     label: "High",     color: theme.green },
];

function todayIso() { return new Date().toISOString().slice(0, 10); }

// ── Hooks ────────────────────────────────────────────────────────────────────

function useEarningsUniverse() {
  const [state, setState] = useState({ loading: true, error: null, rows: [] });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res  = await fetch("/api/earnings-dates");
        const data = await res.json();
        if (!alive) return;
        if (!data.ok) throw new Error(data.error || "earnings-dates failed");
        const today = todayIso();
        const rows = (data.earnings || []).filter(r => {
          const d = daysBetween(today, r.date);
          return d >= 0 && d <= 21;
        });
        setState({ loading: false, error: null, rows });
      } catch (err) {
        if (alive) setState({ loading: false, error: err.message, rows: [] });
      }
    })();
    return () => { alive = false; };
  }, []);
  return state;
}

function useChainByExpiry(ticker, expiries) {
  const key = ticker + "|" + expiries.join(",");
  const [state, setState] = useState({ loading: false, error: null, chainByExpiry: {}, spot: null });
  useEffect(() => {
    if (!ticker || !expiries.length) {
      setState({ loading: false, error: null, chainByExpiry: {}, spot: null });
      return;
    }
    let alive = true;
    setState(s => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const responses = await Promise.all(
          expiries.map(e => fetch(`/api/earnings-chain?ticker=${ticker}&expiry=${e}`).then(r => r.json()))
        );
        if (!alive) return;
        const chainByExpiry = {};
        let spot = null;
        for (const res of responses) {
          if (!res.ok) continue;
          chainByExpiry[res.expiry] = { atmIV: res.atmIV, atmStrike: res.atmStrike, strikes: res.strikes || [] };
          if (spot == null && res.spot != null) spot = res.spot;
        }
        setState({ loading: false, error: null, chainByExpiry, spot });
      } catch (err) {
        if (alive) setState({ loading: false, error: err.message, chainByExpiry: {}, spot: null });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

function useTickerSignals(ticker) {
  const [state, setState] = useState({ bbPosition: null, ivRank: null });
  useEffect(() => {
    if (!ticker) { setState({ bbPosition: null, ivRank: null }); return; }
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("quotes")
        .select("bb_position, iv_rank")
        .eq("symbol", ticker)
        .eq("instrument_type", "EQUITY")
        .single();
      if (!alive) return;
      setState({ bbPosition: data?.bb_position ?? null, ivRank: data?.iv_rank ?? null });
    })();
    return () => { alive = false; };
  }, [ticker]);
  return state;
}

// ── Layout primitives ────────────────────────────────────────────────────────

function Panel({ children, style }) {
  return (
    <div style={{
      background: bg.surface, border: `1px solid ${border.default}`,
      borderRadius: r.md, padding: sp[4], ...style,
    }}>
      {children}
    </div>
  );
}

function PanelHeader({ label, sub, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: sp[3] }}>
      <div>
        <span style={{ fontFamily: font.mono, fontSize: sz.xs, letterSpacing: "0.14em",
                       textTransform: "uppercase", color: text.muted, fontWeight: 600 }}>
          {label}
        </span>
        {sub && <span style={{ marginLeft: sp[2], fontFamily: font.mono, fontSize: sz.xs, color: text.subtle }}>{sub}</span>}
      </div>
      {right}
    </div>
  );
}

function Datum({ label, value, sub, color }) {
  return (
    <div>
      <div style={{ fontFamily: font.mono, fontSize: sz.xs, color: text.subtle,
                    letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontFamily: font.mono, fontSize: sz.sm, color: color || text.primary, fontWeight: 600 }}>
        {value}
      </div>
      {sub && <div style={{ fontFamily: font.mono, fontSize: sz.xs, color: text.subtle }}>{sub}</div>}
    </div>
  );
}

function KeyVal({ k, v, vColor }) {
  return (
    <div>
      <div style={{ fontFamily: font.mono, fontSize: sz.xs, color: text.muted,
                    letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>
        {k}
      </div>
      <div style={{ fontFamily: font.mono, fontSize: sz.sm, color: vColor || text.primary }}>{v}</div>
    </div>
  );
}

function SectionLabel({ label }) {
  return (
    <div style={{ fontFamily: font.mono, fontSize: sz.xs, letterSpacing: "0.14em",
                  textTransform: "uppercase", color: text.subtle, marginBottom: sp[2] }}>
      {label}
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function ExpectedMovePanel({ em, spot, earningsIso }) {
  if (em?.emDollars == null || spot == null) return null;
  return (
    <Panel>
      <PanelHeader label="Expected Move" sub="From earnings-week ATM IV" />
      <div style={{ display: "flex", gap: sp[6], flexWrap: "wrap" }}>
        <Datum label="Spot"           value={`$${spot.toFixed(2)}`} />
        <Datum label="Earnings"       value={earningsIso} sub={`in ${em.dteToEarnings}d`} />
        <Datum label="ATM IV"         value={em.atmIV != null ? `${(em.atmIV * 100).toFixed(1)}%` : "—"}
               sub={em.earningsWeekExpiry ? `exp ${em.earningsWeekExpiry}` : null} />
        <Datum label="Expected Move"  value={`±$${em.emDollars.toFixed(2)}`}
               sub={em.emPct != null ? `±${em.emPct.toFixed(1)}% of spot` : null}
               color={theme.amber} />
        <Datum label="Lower Bound"    value={`$${em.lowerBound.toFixed(2)}`} color={theme.red} />
        <Datum label="Upper Bound"    value={`$${em.upperBound.toFixed(2)}`} color={theme.green} />
      </div>
    </Panel>
  );
}

function DeploymentGatePanel({ gate }) {
  if (!gate || gate.status === "unknown") return (
    <Panel>
      <PanelHeader label="Deployment Gate" sub="VIX-based cash floor check" />
      <div style={{ fontFamily: font.mono, fontSize: sz.sm, color: text.muted }}>VIX or cash data unavailable.</div>
    </Panel>
  );
  const statusColor = gate.status === "open" ? theme.green : gate.status === "tight" ? theme.amber : theme.red;
  const statusLabel = gate.status === "open" ? "Open — room to deploy" : gate.status === "tight" ? "Tight — limited room" : "At floor — hold cash";
  return (
    <Panel>
      <PanelHeader label="Deployment Gate" sub="VIX-based cash floor check" />
      <div style={{ display: "flex", flexDirection: "column", gap: sp[3] }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: sp[3] }}>
          <Datum label="VIX"        value={gate.vix != null ? gate.vix.toFixed(1) : "—"} sub={gate.band?.label ?? null} />
          <Datum label="Sentiment"  value={gate.band?.sentiment ?? "—"} />
          <Datum label="Cash Floor" value={gate.floorPct != null ? `${(gate.floorPct * 100).toFixed(0)}%` : "—"}
                 sub="min cash to hold" />
          <Datum label="Free Cash"  value={gate.freeCashPct != null ? `${(gate.freeCashPct * 100).toFixed(1)}%` : "—"} />
          <Datum label="Room"       value={gate.roomToDeploy != null ? `${(gate.roomToDeploy * 100).toFixed(1)}%` : "—"}
                 color={statusColor} />
        </div>
        <div style={{
          padding: `${sp[2]}px ${sp[3]}px`, fontFamily: font.mono, fontSize: sz.sm,
          background: statusColor + "12", border: `1px solid ${statusColor}44`,
          borderRadius: r.sm,
        }}>
          <span style={{ color: statusColor, letterSpacing: "0.08em", fontSize: sz.xs, marginRight: sp[2] }}>STATUS:</span>
          {statusLabel}
          {gate.marginPct != null && (
            <span style={{ color: text.muted, marginLeft: sp[3] }}>
              (~${Math.round(gate.marginPct).toLocaleString()} deployable)
            </span>
          )}
        </div>
      </div>
    </Panel>
  );
}

function TickerHistoryPanel({ familiarity, baseline }) {
  const fmt = r => r != null ? `${(r * 100).toFixed(2)}%` : "—";
  return (
    <Panel>
      <PanelHeader label="Ticker History" sub="Your closed CSPs on this ticker" />
      {!familiarity ? (
        <div style={{ fontFamily: font.mono, fontSize: sz.sm, color: text.muted }}>Select a ticker to see history.</div>
      ) : familiarity.lifetimeCsps === 0 ? (
        <div style={{ fontFamily: font.mono, fontSize: sz.sm, color: text.muted }}>No closed CSPs on this ticker yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: sp[3] }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: sp[3] }}>
            <Datum label="Lifetime CSPs" value={familiarity.lifetimeCsps} />
            <Datum label="Assignments"   value={familiarity.assignments}
                   sub={`${((familiarity.assignments / familiarity.lifetimeCsps) * 100).toFixed(0)}% rate`} />
            <Datum label="Win Rate"      value={familiarity.winRate != null ? `${(familiarity.winRate * 100).toFixed(0)}%` : "—"} />
            <Datum label="Avg ROI"       value={fmt(familiarity.avgRoi)} />
            <Datum label="vs Portfolio"
                   value={familiarity.relativeRoi != null
                     ? `${familiarity.relativeRoi >= 0 ? "+" : ""}${(familiarity.relativeRoi * 100).toFixed(2)}%`
                     : "—"}
                   color={familiarity.relativeRoi == null ? text.muted : familiarity.relativeRoi >= 0 ? theme.green : theme.red}
                   sub={baseline?.count ? `vs ${fmt(baseline.avgRoi)} avg` : null} />
          </div>
          {(familiarity.lastTrade || familiarity.best) && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: sp[3] }}>
              {familiarity.lastTrade && <KeyVal k="Last trade" v={`${familiarity.lastTrade.close} · ${fmt(familiarity.lastTrade.roi)}`} />}
              {familiarity.best      && <KeyVal k="Best"       v={`${familiarity.best.close} · ${fmt(familiarity.best.roi)}`}       vColor={theme.green} />}
              {familiarity.worst     && <KeyVal k="Worst"      v={`${familiarity.worst.close} · ${fmt(familiarity.worst.roi)}`}     vColor={theme.red} />}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function ConvictionFactorsPanel({ factors, suggested, currentPositions, right }) {
  const posLines = [];
  if (currentPositions) {
    const { csps, shares, leaps } = currentPositions;
    if (csps.length) {
      const detail = csps.map(c => `$${c.strike}p ${c.expiration ?? c.expiry ?? ""}`.trim()).join(", ");
      posLines.push(`${csps.length} CSP${csps.length > 1 ? "s" : ""} · ${detail}`);
    } else {
      posLines.push("0 CSPs");
    }
    if (shares.length) {
      const sh = shares.reduce((sum, s) => sum + (s.shares || s.quantity || 100), 0);
      posLines.push(`${sh} sh`);
    } else {
      posLines.push("0 sh");
    }
    posLines.push(leaps.length ? `${leaps.length} LEAP${leaps.length > 1 ? "s" : ""}` : "0 LEAPs");
  }

  if (!factors?.length && !posLines.length) return null;

  return (
    <Panel>
      <PanelHeader label="Conviction Factors" sub="Decision-support signals" right={right} />
      <div style={{ display: "flex", flexDirection: "column", gap: sp[3] }}>
        {factors.map((f, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "140px 1fr 180px", gap: sp[3],
            fontFamily: font.mono, fontSize: sz.sm, alignItems: "baseline",
          }}>
            <span style={{ color: text.muted, fontSize: sz.xs, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {f.label}
            </span>
            <span style={{ color: text.primary }}>{f.value}</span>
            <span style={{ color: text.subtle, fontSize: sz.xs, textAlign: "right" }}>→ {f.suggests}</span>
          </div>
        ))}

        {posLines.length > 0 && (
          <div style={{
            display: "grid", gridTemplateColumns: "140px 1fr", gap: sp[3],
            fontFamily: font.mono, fontSize: sz.sm, alignItems: "baseline",
            borderTop: factors.length ? `1px solid ${border.default}` : "none",
            paddingTop: factors.length ? sp[3] : 0,
          }}>
            <span style={{ color: text.muted, fontSize: sz.xs, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Current exposure
            </span>
            <span style={{ color: text.primary }}>{posLines.join(" · ")}</span>
          </div>
        )}

        {suggested && (
          <div style={{
            marginTop: sp[1], padding: `${sp[2]}px ${sp[3]}px`,
            background: theme.amber + "12", border: `1px solid ${theme.amber}55`,
            fontFamily: font.mono, fontSize: sz.sm, color: text.primary,
            borderRadius: r.sm,
          }}>
            <span style={{ color: theme.amber, letterSpacing: "0.1em", fontSize: sz.xs, marginRight: sp[2] }}>
              BASED ON SIGNALS:
            </span>
            {suggested}
          </div>
        )}
      </div>
    </Panel>
  );
}

function ConvictionPicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: sp[1] }}>
      {CONVICTIONS.map(c => {
        const active = value === c.k;
        return (
          <button key={c.k} onClick={() => onChange(c.k)} style={{
            padding: `${sp[1]}px ${sp[3]}px`,
            border: `1px solid ${active ? c.color : border.default}`,
            background: active ? c.color + "18" : "transparent",
            color: active ? c.color : text.muted,
            fontSize: sz.xs, fontFamily: font.mono, letterSpacing: "0.1em", textTransform: "uppercase",
            cursor: "pointer", borderRadius: r.sm,
          }}>{c.label}</button>
        );
      })}
    </div>
  );
}

function handleUsePlay(id, path) {
  const line = `PATH ${id} · $${path.strike}p · ${path.expiry} · ${(path.delta * 100).toFixed(0)}Δ · prem $${Math.round(path.premium || 0)}`;
  try { navigator.clipboard?.writeText(line); } catch {}
}

function PathCard({ id, path, spot, em, positions, accountValue, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const accent = PATH_ACCENT[id];

  const currentConc = computeTickerConcentration(path._ticker, positions, accountValue);
  const projConc    = projectedConcentration(currentConc, path.strike, accountValue);
  const roomToTen   = projConc != null ? Math.max(0, 0.10 - projConc) : null;
  const strikeDiscountPct = spot ? ((path.strike - spot) / spot) * 100 : null;
  const strikeVsLowerLbl = path.strikeVsLower != null
    ? (path.strikeVsLower >= 0 ? `+$${path.strikeVsLower.toFixed(2)} above` : `-$${Math.abs(path.strikeVsLower).toFixed(2)} below`)
    : "—";

  return (
    <div style={{ border: `1px solid ${border.default}`, borderRadius: r.md, overflow: "hidden" }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: `${sp[3]}px ${sp[4]}px`, cursor: "pointer",
          background: bg.surface,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          borderBottom: open ? `1px solid ${border.default}` : "none",
        }}
      >
        <div>
          <span style={{ fontFamily: font.mono, fontSize: sz.xs, letterSpacing: "0.16em",
                         textTransform: "uppercase", color: accent, fontWeight: 600 }}>
            Path {id} — {path.label}
          </span>
          <span style={{ marginLeft: sp[3], fontFamily: font.mono, fontSize: sz.xs, color: text.subtle }}>
            {path.tagline}
          </span>
        </div>
        <div style={{ display: "flex", gap: sp[3], fontFamily: font.mono, fontSize: sz.xs, color: text.muted, alignItems: "center" }}>
          {path.available ? (
            <span>${path.strike}p · {(path.delta * 100).toFixed(0)}Δ</span>
          ) : (
            <span style={{ color: text.faint }}>unavailable</span>
          )}
          <span>{open ? "▾" : "▸"}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: sp[4], background: bg.elevated, display: "flex", flexDirection: "column", gap: sp[4] }}>
          {!path.available ? (
            <div style={{ fontFamily: font.mono, fontSize: sz.sm, color: text.subtle }}>
              No contract matched this path's delta + price target.
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: sp[3] }}>
                <Datum label="Expiry"   value={path.expiry}  sub={`${path.dte} DTE`} />
                <Datum label="Strike"   value={`$${path.strike}p`} sub={`${(path.delta * 100).toFixed(0)}Δ`} />
                <Datum label="Premium"  value={path.premium != null ? `$${Math.round(path.premium)}` : "—"}
                       sub={path.mid != null ? `mid $${path.mid.toFixed(2)}` : null} color={accent} />
                <Datum label="ROI"      value={path.roi != null ? `${path.roi.toFixed(1)}%` : "—"}
                       sub={`on $${path.collateral?.toLocaleString()}`} />
              </div>

              <div>
                <SectionLabel label="Positioning" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: sp[3] }}>
                  <KeyVal k="Stock price"          v={`$${spot?.toFixed(2) ?? "—"}`} />
                  <KeyVal k="Strike discount"      v={strikeDiscountPct != null ? `${strikeDiscountPct.toFixed(1)}%` : "—"} />
                  <KeyVal k="Expected lower bound" v={em?.lowerBound != null ? `$${em.lowerBound.toFixed(2)}` : "—"} />
                  <KeyVal k="Strike vs lower"      v={strikeVsLowerLbl}
                          vColor={path.strikeVsLower != null
                            ? (path.strikeVsLower > 0 ? theme.green : path.strikeVsLower < 0 ? theme.red : text.primary)
                            : text.muted} />
                </div>
              </div>

              <div>
                <SectionLabel label="Trade Rationale" />
                <p style={{ fontFamily: font.mono, fontSize: sz.sm, color: text.secondary,
                            lineHeight: 1.55, margin: 0 }}>
                  {path.description}
                </p>
                {path.evidence?.[0] && (
                  <blockquote style={{
                    margin: `${sp[3]}px 0 0`, padding: `${sp[2]}px ${sp[3]}px`,
                    borderLeft: `2px solid ${accent}`,
                    background: accent + "0a",
                    fontFamily: font.mono, fontSize: sz.xs, color: text.muted,
                    fontStyle: "italic",
                  }}>
                    "{path.evidence[0].quote}"
                    <span style={{ color: text.subtle, fontStyle: "normal", marginLeft: sp[2] }}>
                      — {path.evidence[0].trade}
                    </span>
                  </blockquote>
                )}
              </div>

              <div>
                <SectionLabel label="Assignment Scenario" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: sp[3] }}>
                  <KeyVal k="If assigned" v={`100 sh @ $${path.strike} = $${(path.strike * 100).toLocaleString()}`} />
                  <KeyVal k="Current concentration"
                          v={currentConc != null ? `${(currentConc * 100).toFixed(1)}%` : "—"} />
                  <KeyVal k="Projected"
                          v={projConc != null ? `${(projConc * 100).toFixed(1)}%` : "—"}
                          vColor={projConc == null ? text.muted : projConc > 0.10 ? theme.red : projConc > 0.07 ? theme.amber : theme.green} />
                  <KeyVal k="Room to 10% target"
                          v={roomToTen != null ? `${(roomToTen * 100).toFixed(1)}%` : "—"} />
                </div>
              </div>

              <div style={{ display: "flex", gap: sp[2], alignItems: "center" }}>
                <button
                  onClick={() => handleUsePlay(id, path)}
                  style={{
                    padding: `${sp[1]}px ${sp[3]}px`,
                    border: `1px solid ${accent}`, background: accent + "18",
                    color: accent, fontFamily: font.mono, fontSize: sz.xs,
                    letterSpacing: "0.1em", fontWeight: 600, textTransform: "uppercase",
                    borderRadius: r.sm, cursor: "pointer",
                  }}
                >
                  Use this play →
                </button>
                {path.bid != null && path.ask != null && (
                  <span style={{ fontFamily: font.mono, fontSize: sz.xs, color: text.subtle }}>
                    B/A ${path.bid.toFixed(2)} / ${path.ask.toFixed(2)}
                  </span>
                )}
                {path.iv != null && (
                  <span style={{ fontFamily: font.mono, fontSize: sz.xs, color: text.subtle }}>
                    strike IV {(path.iv * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function EarningsTab({ positions, account, trades }) {
  const { loading: uniLoading, error: uniError, rows: uniRows } = useEarningsUniverse();
  const [selected, setSelected]     = useState(null);
  const [conviction, setConviction] = useState("standard");
  const [pathCMode, setPathCMode]   = useState("pre");

  useEffect(() => {
    if (!selected && uniRows.length) setSelected(uniRows[0].ticker);
  }, [uniRows, selected]);

  const picked       = uniRows.find(r => r.ticker === selected);
  const earningsIso  = picked?.date ?? null;
  const today        = todayIso();
  const accountValue = account?.account_value ?? null;

  const targetExpiries = useMemo(() => {
    if (!earningsIso) return [];
    const fridays = getUpcomingFridays(today, 70);
    const pre  = pickPreEarningsExpiry(fridays, earningsIso)?.expiry;
    const week = pickEarningsWeekExpiry(fridays, earningsIso)?.expiry;
    const weekIdx = week ? fridays.findIndex(f => f.expiry === week) : -1;
    const post = weekIdx >= 0 && weekIdx + 1 < fridays.length ? fridays[weekIdx + 1].expiry : null;
    return [...new Set([pre, week, post].filter(Boolean))];
  }, [earningsIso, today]);

  const { loading: chainLoading, error: chainError, chainByExpiry, spot } =
    useChainByExpiry(selected, targetExpiries);

  const { bbPosition, ivRank } = useTickerSignals(selected);

  const concentration = useMemo(() =>
    computeTickerConcentration(selected, positions, accountValue),
    [selected, positions, accountValue]
  );

  const portfolioBaseline = useMemo(() => computePortfolioBaseline(trades), [trades]);

  const familiarity = useMemo(() =>
    computeFamiliarity(selected, trades, portfolioBaseline),
    [selected, trades, portfolioBaseline]
  );

  const deploymentGate = useMemo(() => {
    const vix         = account?.vix_current ?? null;
    const freeCashPct = account?.free_cash_pct_est ?? null;
    return computeDeploymentGate(vix, freeCashPct, accountValue);
  }, [account, accountValue]);

  const conv = useMemo(() =>
    scoreConvictionFactors({ bbPosition, ivRank, concentration, familiarity }),
    [bbPosition, ivRank, concentration, familiarity]
  );

  const currentPositions = useMemo(() => {
    if (!selected || !positions) return null;
    const csps   = (positions.open_csps       || []).filter(p => p.ticker === selected);
    const shares = (positions.assigned_shares  || []).filter(s => s.ticker === selected);
    const leaps  = [
      ...(positions.open_leaps || []).filter(l => l.ticker === selected),
      ...shares.flatMap(s => s.open_leaps || []),
    ];
    return { csps, shares, leaps };
  }, [selected, positions]);

  const result = useMemo(() => {
    if (!earningsIso || !selected || !spot) return null;
    const built = buildEarningsPaths({
      ticker: selected, earningsIso, todayIso: today, spot, chainByExpiry,
      pathCExpiryOverride: pathCMode === "post" ? "post" : null,
    });
    for (const p of Object.values(built.paths)) p._ticker = selected;
    return built;
  }, [selected, earningsIso, today, spot, chainByExpiry, pathCMode]);

  const [promA, promB] = CONVICTION_PROMINENCE[conviction];
  const prominentIds   = [promA, promB];
  const collapsedIds   = ["A", "B", "C", "D"].filter(k => !prominentIds.includes(k));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: sp[4] }}>
      {/* Ticker picker */}
      <Panel>
        <PanelHeader
          label="Earnings Play Tool"
          sub="Four documented wheel CSP patterns around a scheduled earnings event (0–21 DTE)"
        />
        {uniLoading ? (
          <div style={{ fontFamily: font.mono, fontSize: sz.sm, color: text.muted }}>Loading earnings calendar…</div>
        ) : uniError ? (
          <div style={{ fontFamily: font.mono, fontSize: sz.sm, color: theme.red }}>{uniError}</div>
        ) : !uniRows.length ? (
          <div style={{ fontFamily: font.mono, fontSize: sz.sm, color: text.subtle }}>
            No wheel-universe earnings in the next 21 days.
          </div>
        ) : (
          <div style={{ display: "flex", gap: sp[4], alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: sp[2], alignItems: "center",
                            fontFamily: font.mono, fontSize: sz.xs, color: text.muted,
                            letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Ticker
              <select
                value={selected || ""}
                onChange={e => setSelected(e.target.value)}
                style={{
                  background: bg.base, color: text.primary,
                  border: `1px solid ${border.default}`,
                  fontFamily: font.mono, fontSize: sz.sm,
                  padding: `${sp[1]}px ${sp[3]}px`, borderRadius: r.sm,
                }}
              >
                {uniRows.map(r => {
                  const d = daysBetween(today, r.date);
                  return (
                    <option key={r.ticker} value={r.ticker}>
                      {r.ticker} · {r.date} · {d}d{r.hour ? ` · ${r.hour}` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <span style={{ fontFamily: font.mono, fontSize: sz.xs, color: text.subtle }}>
              {uniRows.length} upcoming
            </span>
          </div>
        )}
      </Panel>

      {/* Expected move */}
      {selected && (
        chainLoading ? (
          <Panel>
            <div style={{ fontFamily: font.mono, fontSize: sz.sm, color: text.muted }}>Fetching option chain…</div>
          </Panel>
        ) : chainError ? (
          <Panel>
            <div style={{ fontFamily: font.mono, fontSize: sz.sm, color: theme.red }}>{chainError}</div>
          </Panel>
        ) : result ? (
          <ExpectedMovePanel em={result.expectedMove} spot={spot} earningsIso={earningsIso} />
        ) : null
      )}

      {/* Four paths */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: sp[3] }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: sp[2] }}>
            <div style={{ fontFamily: font.mono, fontSize: sz.xs, letterSpacing: "0.14em",
                          textTransform: "uppercase", color: text.subtle }}>
              Prominent for {conviction} conviction
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: sp[2], fontFamily: font.mono, fontSize: sz.xs, color: text.muted }}>
              <span style={{ letterSpacing: "0.08em" }}>PATH C EXPIRY:</span>
              {["pre", "post"].map(m => (
                <button key={m} onClick={() => setPathCMode(m)} style={{
                  padding: `3px ${sp[2]}px`,
                  border: `1px solid ${pathCMode === m ? theme.amber : border.default}`,
                  background: pathCMode === m ? theme.amber + "18" : "transparent",
                  color: pathCMode === m ? theme.amber : text.muted,
                  fontFamily: font.mono, fontSize: sz.xs,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  cursor: "pointer", borderRadius: r.sm,
                }}>
                  {m === "pre" ? "earnings-wk" : "post-earnings"}
                </button>
              ))}
            </div>
          </div>

          {/* Prominent pair */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: sp[3] }}>
            {prominentIds.map(id => (
              <PathCard key={id} id={id} path={result.paths[id]} spot={spot}
                        em={result.expectedMove} positions={positions}
                        accountValue={accountValue} defaultOpen={true} />
            ))}
          </div>

          {/* Other paths */}
          <div style={{ fontFamily: font.mono, fontSize: sz.xs, letterSpacing: "0.14em",
                        textTransform: "uppercase", color: text.faint, margin: `${sp[2]}px 0` }}>
            — Other paths —
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: sp[2] }}>
            {collapsedIds.map(id => (
              <PathCard key={id} id={id} path={result.paths[id]} spot={spot}
                        em={result.expectedMove} positions={positions}
                        accountValue={accountValue} defaultOpen={false} />
            ))}
          </div>
        </div>
      )}

      {/* Conviction factors */}
      {selected && (conv.factors.length > 0 || currentPositions) && (
        <ConvictionFactorsPanel
          factors={conv.factors}
          suggested={conv.suggested}
          currentPositions={currentPositions}
          right={<ConvictionPicker value={conviction} onChange={setConviction} />}
        />
      )}

      {/* Deployment gate */}
      {selected && <DeploymentGatePanel gate={deploymentGate} />}

      {/* Ticker history */}
      {selected && <TickerHistoryPanel familiarity={familiarity} baseline={portfolioBaseline} />}
    </div>
  );
}
