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
      {/* Header row */}
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

      {/* Body */}
      {open && (
        <div style={{ padding: sp[4], background: bg.elevated, display: "flex", flexDirection: "column", gap: sp[4] }}>
          {!path.available ? (
            <div style={{ fontFamily: font.mono, fontSize: sz.sm, color: text.subtle }}>
              No contract matched this path's delta + price target.
            </div>
          ) : (
            <>
              {/* Headline metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: sp[3] }}>
                <Datum label="Expiry"   value={path.expiry}  sub={`${path.dte} DTE`} />
                <Datum label="Strike"   value={`$${path.strike}p`} sub={`${(path.delta * 100).toFixed(0)}Δ`} />
                <Datum label="Premium"  value={path.premium != null ? `$${Math.round(path.premium)}` : "—"}
                       sub={path.mid != null ? `mid $${path.mid.toFixed(2)}` : null} color={accent} />
                <Datum label="ROI"      value={path.roi != null ? `${path.roi.toFixed(1)}%` : "—"}
                       sub={`on $${path.collateral?.toLocaleString()}`} />
              </div>

              {/* Positioning */}
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

              {/* Ryan's pattern */}
              <div>
                <SectionLabel label="Ryan's Pattern" />
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

              {/* Assignment scenario */}
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

              {/* CTA */}
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

export function EarningsTab({ positions, account }) {
  const { loading: uniLoading, error: uniError, rows: uniRows } = useEarningsUniverse();
  const [selected, setSelected]   = useState(null);
  const [conviction, setConviction] = useState("standard");

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
    return [...new Set([pre, week].filter(Boolean))];
  }, [earningsIso, today]);

  const { loading: chainLoading, error: chainError, chainByExpiry, spot } =
    useChainByExpiry(selected, targetExpiries);

  const { bbPosition, ivRank } = useTickerSignals(selected);

  const concentration = useMemo(() =>
    computeTickerConcentration(selected, positions, accountValue),
    [selected, positions, accountValue]
  );

  const conv = useMemo(() =>
    scoreConvictionFactors({ bbPosition, ivRank, concentration }),
    [bbPosition, ivRank, concentration]
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
    const built = buildEarningsPaths({ ticker: selected, earningsIso, todayIso: today, spot, chainByExpiry });
    for (const p of Object.values(built.paths)) p._ticker = selected;
    return built;
  }, [selected, earningsIso, today, spot, chainByExpiry]);

  const [promA, promB] = CONVICTION_PROMINENCE[conviction];
  const prominentIds   = [promA, promB];
  const collapsedIds   = ["A", "B", "C", "D"].filter(k => !prominentIds.includes(k));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: sp[4] }}>
      {/* Ticker picker */}
      <Panel>
        <PanelHeader
          label="Earnings Play Tool"
          sub="Four Ryan Hildreth CSP patterns around a scheduled earnings event (0–21 DTE)"
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

      {/* Conviction factors */}
      {selected && (conv.factors.length > 0 || currentPositions) && (
        <ConvictionFactorsPanel
          factors={conv.factors}
          suggested={conv.suggested}
          currentPositions={currentPositions}
          right={<ConvictionPicker value={conviction} onChange={setConviction} />}
        />
      )}

      {/* Four paths */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: sp[3] }}>
          <div style={{ fontFamily: font.mono, fontSize: sz.xs, letterSpacing: "0.14em",
                        textTransform: "uppercase", color: text.subtle }}>
            Prominent for {conviction} conviction
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
    </div>
  );
}
