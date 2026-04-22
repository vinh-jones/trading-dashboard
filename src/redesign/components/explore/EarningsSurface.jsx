import { useEffect, useMemo, useState } from "react";
import { T } from "../../theme.js";
import { Frame, SectionLabel, Empty, Datum, Pill } from "../../primitives.jsx";
import { supabase } from "../../../lib/supabase.js";
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
} from "../../../lib/earningsEngine.js";

const CONVICTIONS = [
  { k: "low",      label: "Low",      color: T.blue   },
  { k: "standard", label: "Standard", color: T.amber  },
  { k: "high",     label: "High",     color: T.green  },
];

const PATH_ACCENT = {
  A: { accentKey: "quiet",   head: T.tm    },
  B: { accentKey: "focus",   head: T.blue  },
  C: { accentKey: "warn",    head: T.amber },
  D: { accentKey: "ok",      head: T.green },
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

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
        // Spec: 0–21 days only
        const today = todayIso();
        const rows = (data.earnings || []).filter(r => {
          const days = daysBetween(today, r.date);
          return days >= 0 && days <= 21;
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
        for (const r of responses) {
          if (!r.ok) continue;
          chainByExpiry[r.expiry] = { atmIV: r.atmIV, atmStrike: r.atmStrike, strikes: r.strikes || [] };
          if (spot == null && r.spot != null) spot = r.spot;
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

// Pulls bb_position + iv_rank from quotes for the selected ticker.
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
      setState({
        bbPosition: data?.bb_position ?? null,
        ivRank:     data?.iv_rank     ?? null,
      });
    })();
    return () => { alive = false; };
  }, [ticker]);
  return state;
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function ExpectedMovePanel({ em, spot, earningsIso }) {
  if (em?.emDollars == null || spot == null) return null;
  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <Datum label="SPOT"           value={`$${spot.toFixed(2)}`} />
      <Datum label="EARN"           value={earningsIso} sub={`in ${em.dteToEarnings}d`} />
      <Datum label="ATM IV"         value={em.atmIV != null ? `${(em.atmIV * 100).toFixed(1)}%` : "—"}
             sub={em.earningsWeekExpiry ? `earnings-wk ${em.earningsWeekExpiry}` : null} />
      <Datum label="EXPECTED MOVE"  value={`±$${em.emDollars.toFixed(2)}`}
             sub={em.emPct != null ? `±${em.emPct.toFixed(1)}% of spot` : null}
             color={T.amber} />
      <Datum label="LOWER BOUND"    value={`$${em.lowerBound.toFixed(2)}`} color={T.red} />
      <Datum label="UPPER BOUND"    value={`$${em.upperBound.toFixed(2)}`} color={T.green} />
    </div>
  );
}

function ConvictionFactorsPanel({ factors, suggested }) {
  if (!factors?.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {factors.map((f, i) => (
        <div key={i} style={{
          display: "grid", gridTemplateColumns: "140px 1fr 180px", gap: 12, alignItems: "baseline",
          fontFamily: T.mono, fontSize: T.sm,
        }}>
          <span style={{ color: T.tm, letterSpacing: "0.08em", fontSize: T.xs, textTransform: "uppercase" }}>
            {f.label}
          </span>
          <span style={{ color: T.t1 }}>{f.value}</span>
          <span style={{ color: T.ts, fontSize: T.xs, textAlign: "right" }}>→ {f.suggests}</span>
        </div>
      ))}
      <div style={{
        marginTop: 4, padding: "8px 12px",
        background: T.post + "12", border: `1px solid ${T.post}55`,
        fontFamily: T.mono, fontSize: T.sm, color: T.t1,
      }}>
        <span style={{ color: T.post, letterSpacing: "0.1em", fontSize: T.xs, marginRight: 8 }}>
          BASED ON SIGNALS:
        </span>
        {suggested}
      </div>
    </div>
  );
}

function ConvictionPicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {CONVICTIONS.map(c => {
        const active = value === c.k;
        return (
          <button key={c.k} onClick={() => onChange(c.k)} style={{
            padding: "5px 12px",
            border: `1px solid ${active ? c.color : T.bd}`,
            background: active ? c.color + "18" : "transparent",
            color: active ? c.color : T.tm,
            fontSize: T.xs, fontFamily: T.mono, letterSpacing: "0.1em", textTransform: "uppercase",
            cursor: "pointer", borderRadius: T.rSm,
          }}>{c.label}</button>
        );
      })}
    </div>
  );
}

function PathHeaderRow({ id, path, prominent, onToggle, isOpen }) {
  const a = PATH_ACCENT[id];
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        padding: prominent ? "0 0 10px" : "8px 12px",
        cursor: onToggle ? "pointer" : "default",
        borderBottom: prominent ? `1px solid ${T.hair}` : "none",
        background: prominent ? "transparent" : T.surf,
        border: prominent ? "none" : `1px solid ${T.bd}`,
      }}
    >
      <div>
        <span style={{
          fontSize: T.xs, letterSpacing: "0.18em", textTransform: "uppercase",
          color: a.head, fontWeight: 600, fontFamily: T.mono,
        }}>
          <span style={{ opacity: 0.6, marginRight: 6 }}>▸</span>
          PATH {id} — {path.label}
        </span>
        <span style={{ marginLeft: 10, color: T.ts, fontSize: T.xs, fontFamily: T.mono }}>
          {path.tagline}
        </span>
      </div>
      {!prominent && (
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", fontFamily: T.mono, fontSize: T.xs, color: T.tm }}>
          {path.available ? (
            <>
              <span>${path.strike}p · {(path.delta * 100).toFixed(0)}Δ</span>
              <span style={{ color: T.ts }}>{isOpen ? "▾" : "▸"}</span>
            </>
          ) : (
            <span style={{ color: T.tf }}>unavailable {isOpen ? "▾" : "▸"}</span>
          )}
        </div>
      )}
    </div>
  );
}

function PathBody({ id, path, spot, em, positions, accountValue }) {
  if (!path.available) {
    return (
      <Empty compact glyph="∅" accent="quiet"
        title="No contract available for this path."
        body="Chain did not return a strike matching this path's delta + price target." />
    );
  }

  const currentConc = computeTickerConcentration(path._ticker, positions, accountValue);
  const projConc    = projectedConcentration(currentConc, path.strike, accountValue);
  const roomToTen   = projConc != null ? Math.max(0, 0.10 - projConc) : null;

  const strikeDiscountPct = spot ? ((path.strike - spot) / spot) * 100 : null;
  const strikeVsLowerLbl = path.strikeVsLower != null
    ? (path.strikeVsLower >= 0 ? `+$${path.strikeVsLower.toFixed(2)} above` : `-$${Math.abs(path.strikeVsLower).toFixed(2)} below`)
    : "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Headline metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
        <Datum label="EXPIRY"   value={path.expiry} sub={`${path.dte} DTE`} />
        <Datum label="STRIKE"   value={`$${path.strike}p`}
               sub={`${(path.delta * 100).toFixed(0)}Δ`} />
        <Datum label="PREMIUM"  value={path.premium != null ? `$${Math.round(path.premium)}` : "—"}
               sub={path.mid != null ? `mid $${path.mid.toFixed(2)}` : null}
               color={PATH_ACCENT[id].head} />
        <Datum label="ROI"      value={path.roi != null ? `${path.roi.toFixed(1)}%` : "—"}
               sub={`on $${path.collateral?.toLocaleString()}`} />
      </div>

      {/* Positioning */}
      <div>
        <SectionLabel label="POSITIONING" />
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10,
                      fontFamily: T.mono, fontSize: T.sm }}>
          <KeyVal k="Stock price"          v={`$${spot?.toFixed(2) ?? "—"}`} />
          <KeyVal k="Strike discount"      v={strikeDiscountPct != null ? `${strikeDiscountPct.toFixed(1)}%` : "—"} />
          <KeyVal k="Expected lower bound" v={em?.lowerBound != null ? `$${em.lowerBound.toFixed(2)}` : "—"} />
          <KeyVal k="Strike vs lower"      v={strikeVsLowerLbl}
                  vColor={path.strikeVsLower != null
                    ? (path.strikeVsLower > 0 ? T.green : path.strikeVsLower < 0 ? T.red : T.t1)
                    : T.tm} />
        </div>
      </div>

      {/* Ryan's pattern */}
      <div>
        <SectionLabel label="RYAN'S PATTERN" />
        <div style={{ marginTop: 8, fontFamily: T.mono, fontSize: T.sm, color: T.t2, lineHeight: 1.55 }}>
          {path.description}
        </div>
        {path.evidence?.[0] && (
          <div style={{
            marginTop: 10, padding: "8px 12px",
            borderLeft: `2px solid ${PATH_ACCENT[id].head}`,
            background: PATH_ACCENT[id].head + "0a",
            fontFamily: T.mono, fontSize: T.xs, color: T.tm, fontStyle: "italic",
          }}>
            "{path.evidence[0].quote}"
            <span style={{ color: T.ts, fontStyle: "normal", marginLeft: 8 }}>— {path.evidence[0].trade}</span>
          </div>
        )}
      </div>

      {/* Assignment scenario */}
      <div>
        <SectionLabel label="ASSIGNMENT SCENARIO" />
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10,
                      fontFamily: T.mono, fontSize: T.sm }}>
          <KeyVal k="If assigned" v={`100 sh @ $${path.strike} = $${(path.strike * 100).toLocaleString()}`} />
          <KeyVal k="Current concentration"
                  v={currentConc != null ? `${(currentConc * 100).toFixed(1)}%` : "—"} />
          <KeyVal k="Projected"
                  v={projConc != null ? `${(projConc * 100).toFixed(1)}%` : "—"}
                  vColor={projConc == null ? T.tm : projConc > 0.10 ? T.red : projConc > 0.07 ? T.amber : T.green} />
          <KeyVal k="Room to 10% target"
                  v={roomToTen != null ? `${(roomToTen * 100).toFixed(1)}%` : "—"} />
        </div>
      </div>

      {/* Use this play CTA */}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          onClick={() => handleUsePlay(id, path)}
          style={{
            padding: "6px 14px",
            border: `1px solid ${PATH_ACCENT[id].head}`,
            background: PATH_ACCENT[id].head + "18",
            color: PATH_ACCENT[id].head,
            fontFamily: T.mono, fontSize: T.xs, letterSpacing: "0.1em", fontWeight: 600,
            textTransform: "uppercase", borderRadius: T.rSm, cursor: "pointer",
          }}
        >
          Use this play →
        </button>
        {path.bid != null && path.ask != null && (
          <Pill color={T.tm}>B/A ${path.bid.toFixed(2)}/${path.ask.toFixed(2)}</Pill>
        )}
        {path.iv != null && <Pill color={T.tm}>strike IV {(path.iv * 100).toFixed(0)}%</Pill>}
      </div>
    </div>
  );
}

function KeyVal({ k, v, vColor }) {
  return (
    <div>
      <div style={{ fontSize: T.xs, color: T.tm, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>{k}</div>
      <div style={{ fontSize: T.sm, color: vColor || T.t1, fontFamily: T.mono }}>{v}</div>
    </div>
  );
}

function handleUsePlay(id, path) {
  // v1: copy a compact summary to clipboard. earnings_plays table write is TBD —
  // we'll wire it once the table is provisioned in Supabase.
  const line = `PATH ${id} · $${path.strike}p · ${path.expiry} · ${(path.delta * 100).toFixed(0)}Δ · prem $${Math.round(path.premium || 0)}`;
  try { navigator.clipboard?.writeText(line); } catch {}
  // Visual ack would be nice; for now the click just copies silently.
}

// ── Main surface ─────────────────────────────────────────────────────────────

export function EarningsSurface({ positions, account }) {
  const { loading: uniLoading, error: uniError, rows: uniRows } = useEarningsUniverse();
  const [selected, setSelected] = useState(null);
  const [conviction, setConviction] = useState("standard");
  const [openExtra, setOpenExtra] = useState(null);  // which collapsed path is expanded

  useEffect(() => {
    if (!selected && uniRows.length) setSelected(uniRows[0].ticker);
  }, [uniRows, selected]);

  const picked = uniRows.find(r => r.ticker === selected);
  const earningsIso = picked?.date ?? null;
  const today = todayIso();
  const accountValue = account?.account_value ?? null;

  const targetExpiries = useMemo(() => {
    if (!earningsIso) return [];
    const fridays = getUpcomingFridays(today, 70);
    const pre  = pickPreEarningsExpiry(fridays, earningsIso)?.expiry;
    const week = pickEarningsWeekExpiry(fridays, earningsIso)?.expiry;
    return [...new Set([pre, week].filter(Boolean))];
  }, [earningsIso, today]);

  const { loading: chainLoading, error: chainError, chainByExpiry, spot } = useChainByExpiry(selected, targetExpiries);
  const { bbPosition, ivRank } = useTickerSignals(selected);

  const concentration = useMemo(() => {
    return computeTickerConcentration(selected, positions, accountValue);
  }, [selected, positions, accountValue]);

  const conv = useMemo(() => scoreConvictionFactors({
    bbPosition, ivRank, concentration,
  }), [bbPosition, ivRank, concentration]);

  const result = useMemo(() => {
    if (!earningsIso || !selected || !spot) return null;
    const built = buildEarningsPaths({
      ticker: selected, earningsIso, todayIso: today, spot, chainByExpiry,
    });
    // Stash ticker on each path so PathBody can compute concentration.
    for (const p of Object.values(built.paths)) p._ticker = selected;
    return built;
  }, [selected, earningsIso, today, spot, chainByExpiry]);

  const [promA, promB] = CONVICTION_PROMINENCE[conviction];
  const prominentIds = [promA, promB];
  const collapsedIds = ["A", "B", "C", "D"].filter(k => !prominentIds.includes(k));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Ticker picker */}
      <Frame accent="warn" title="EARNINGS PLAY TOOL"
        subtitle="Four Ryan Hildreth CSP patterns around a scheduled earnings event (0–21 DTE)"
      >
        {uniLoading ? (
          <div style={{ fontSize: T.sm, color: T.tm, fontFamily: T.mono }}>Loading earnings calendar…</div>
        ) : uniError ? (
          <Empty glyph="✕" accent="amber" compact title="Couldn't load earnings calendar." body={uniError} />
        ) : !uniRows.length ? (
          <Empty glyph="∅" accent="quiet" compact
            title="No wheel-universe earnings in the next 21 days."
            body="The tool only lists tickers with earnings 0–21 days out. Check back closer to the next earnings cluster." />
        ) : (
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: T.xs, color: T.tm, fontFamily: T.mono, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Ticker
              <select value={selected || ""} onChange={e => setSelected(e.target.value)}
                style={{ background: T.bg, color: T.t1, border: `1px solid ${T.bd}`,
                         fontFamily: T.mono, fontSize: T.sm, padding: "5px 10px", borderRadius: T.rSm }}>
                {uniRows.map(r => {
                  const d = daysBetween(today, r.date);
                  return <option key={r.ticker} value={r.ticker}>{r.ticker} · {r.date} · {d}d{r.hour ? ` · ${r.hour}` : ""}</option>;
                })}
              </select>
            </label>
            <span style={{ fontSize: T.xs, color: T.ts, fontFamily: T.mono }}>
              {uniRows.length} upcoming
            </span>
          </div>
        )}
      </Frame>

      {/* Expected move */}
      {selected && (
        <Frame accent="posture" title="EXPECTED MOVE" subtitle="From earnings-week ATM IV">
          {chainLoading ? (
            <div style={{ fontSize: T.sm, color: T.tm, fontFamily: T.mono }}>Fetching option chain…</div>
          ) : chainError ? (
            <Empty glyph="✕" accent="amber" compact title="Chain fetch failed." body={chainError} />
          ) : !result ? (
            <Empty glyph="∅" accent="quiet" compact title="No data yet." />
          ) : (
            <ExpectedMovePanel em={result.expectedMove} spot={spot} earningsIso={earningsIso} />
          )}
        </Frame>
      )}

      {/* Conviction factors */}
      {selected && conv.factors.length > 0 && (
        <Frame accent="focus" title="CONVICTION FACTORS" subtitle="Decision-support signals, not auto-selection"
          right={<ConvictionPicker value={conviction} onChange={setConviction} />}
        >
          <ConvictionFactorsPanel factors={conv.factors} suggested={conv.suggested} />
        </Frame>
      )}

      {/* Four paths */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionLabel label={`VALID PLAYS FOR ${conviction.toUpperCase()} CONVICTION`} right="2 prominent · 2 available" />

          {/* Prominent pair */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
            {prominentIds.map(id => {
              const path = result.paths[id];
              return (
                <Frame key={id} accent={PATH_ACCENT[id].accentKey}
                  title={`PATH ${id} — ${path.label}`} subtitle={path.tagline}>
                  <PathBody id={id} path={path} spot={spot} em={result.expectedMove}
                            positions={positions} accountValue={accountValue} />
                </Frame>
              );
            })}
          </div>

          {/* Collapsed others */}
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: T.xs, letterSpacing: "0.18em", color: T.tf, fontFamily: T.mono, margin: "6px 0" }}>
              ── OTHER PATHS AVAILABLE ──
            </div>
            {collapsedIds.map(id => {
              const path = result.paths[id];
              const isOpen = openExtra === id;
              return (
                <div key={id}>
                  <PathHeaderRow id={id} path={path} prominent={false}
                                 onToggle={() => setOpenExtra(isOpen ? null : id)} isOpen={isOpen} />
                  {isOpen && (
                    <div style={{ padding: 14, border: `1px solid ${T.bd}`, borderTop: "none", background: T.surf }}>
                      <PathBody id={id} path={path} spot={spot} em={result.expectedMove}
                                positions={positions} accountValue={accountValue} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
