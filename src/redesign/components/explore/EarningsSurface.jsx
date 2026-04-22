import { useEffect, useMemo, useState } from "react";
import { T } from "../../theme.js";
import { Frame, SectionLabel, Empty, Datum, Pill } from "../../primitives.jsx";
import {
  buildEarningsPaths,
  getUpcomingFridays,
  pickPreEarningsExpiry,
  pickEarningsWeekExpiry,
  pickPostEarningsExpiry,
  daysBetween,
} from "../../../lib/earningsEngine.js";

const CONVICTIONS = [
  { k: "low",      label: "Low",      color: T.blue   },
  { k: "standard", label: "Standard", color: T.amber  },
  { k: "high",     label: "High",     color: T.green  },
];

const PATH_ACCENT = {
  A: { border: T.tf,    accentKey: "quiet",   head: T.tm    },
  B: { border: T.blue,  accentKey: "focus",   head: T.blue  },
  C: { border: T.amber, accentKey: "warn",    head: T.amber },
  D: { border: T.green, accentKey: "ok",      head: T.green },
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDollars(n) {
  if (n == null) return "—";
  return `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtPct(n, d = 1) {
  if (n == null) return "—";
  return `${n >= 0 ? "" : ""}${n.toFixed(d)}%`;
}

// ── Data hooks ───────────────────────────────────────────────────────────────

// Merge earnings from OpenClaw/Finnhub market_context:
//   - macroEvents with an earnings-like eventType (covers the wheel universe)
//   - positions[].nextEarnings (held tickers — Finnhub pull)
// Keeps the soonest upcoming date per ticker.
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
        setState({ loading: false, error: null, rows: data.earnings || [] });
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

// ── Subcomponents ────────────────────────────────────────────────────────────

function ExpectedMoveBar({ em, spot, earningsIso }) {
  if (em?.emDollars == null || spot == null) return null;
  const emDollars = em.emDollars;
  const emPct     = em.emPct;
  const lo = spot - emDollars;
  const hi = spot + emDollars;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Datum label="SPOT"              value={`$${spot.toFixed(2)}`} />
        <Datum label="EARN"              value={earningsIso}
               sub={`in ${em.dteToEarnings}d`} />
        <Datum label="ATM IV"            value={em.atmIV != null ? `${(em.atmIV * 100).toFixed(1)}%` : "—"}
               sub={em.earningsWeekExpiry ? `week exp ${em.earningsWeekExpiry}` : null} />
        <Datum label="EXPECTED MOVE"     value={`±$${emDollars.toFixed(2)}`}
               sub={emPct != null ? `±${emPct.toFixed(1)}% of spot` : null}
               color={T.amber} />
        <Datum label="IMPLIED RANGE"     value={`$${lo.toFixed(2)} – $${hi.toFixed(2)}`} />
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

function PathCard({ id, path }) {
  const a = PATH_ACCENT[id];
  const isAvoid = id === "A";
  return (
    <Frame
      accent={a.accentKey}
      title={`PATH ${id} — ${path?.label ?? "—"}`}
      subtitle={path?.tagline || ""}
      pad={14}
    >
      {isAvoid ? (
        <div style={{ fontSize: T.sm, color: T.tm, fontFamily: T.mono, lineHeight: 1.55 }}>
          {path?.reason}
        </div>
      ) : !path ? (
        <Empty compact glyph="∅" accent="quiet"
          title="No contract available."
          body="Chain did not return a strike in this delta band for the target expiry." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            <Datum label="STRIKE"   value={path.strike != null ? `$${path.strike}` : "—"}
                   sub={path.pctBelow != null ? `${path.pctBelow.toFixed(1)}% below spot` : null} />
            <Datum label="DELTA"    value={path.delta != null ? path.delta.toFixed(2) : "—"}
                   sub={`target ${(path.targetDelta * 100).toFixed(0)}Δ`} />
            <Datum label="EXPIRY"   value={path.expiry}
                   sub={path.dte != null ? `${path.dte} DTE` : null} />
            <Datum label="PREMIUM"  value={path.premium != null ? `$${Math.round(path.premium)}` : "—"}
                   sub={path.mid != null ? `mid $${path.mid.toFixed(2)}` : null}
                   color={a.head} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: T.xs, color: T.ts, fontFamily: T.mono }}>
            {path.iv != null  && <Pill color={T.tm}>IV {(path.iv * 100).toFixed(0)}%</Pill>}
            {path.bid != null && path.ask != null && (
              <Pill color={T.tm}>B/A ${path.bid.toFixed(2)}/${path.ask.toFixed(2)}</Pill>
            )}
          </div>
          <div style={{ fontSize: T.xs, color: T.tm, fontFamily: T.mono, lineHeight: 1.55, marginTop: 2 }}>
            {path.reason}
          </div>
        </div>
      )}
    </Frame>
  );
}

// ── Main surface ─────────────────────────────────────────────────────────────

export function EarningsSurface() {
  const { loading: uniLoading, error: uniError, rows: uniRows } = useEarningsUniverse();
  const [selected, setSelected] = useState(null);
  const [conviction, setConviction] = useState("standard");

  // Auto-select the first upcoming earnings once data arrives
  useEffect(() => {
    if (!selected && uniRows.length) setSelected(uniRows[0].ticker);
  }, [uniRows, selected]);

  const picked = uniRows.find(r => r.ticker === selected);
  const earningsIso = picked?.date ?? null;
  const today = todayIso();

  // Target expiries the engine will consume (pre, earnings-week, post)
  const targetExpiries = useMemo(() => {
    if (!earningsIso) return [];
    const fridays = getUpcomingFridays(today, 70);
    const pre  = pickPreEarningsExpiry(fridays, earningsIso)?.expiry;
    const week = pickEarningsWeekExpiry(fridays, earningsIso)?.expiry;
    const post = pickPostEarningsExpiry(fridays, earningsIso, 35)?.expiry;
    return [...new Set([pre, week, post].filter(Boolean))];
  }, [earningsIso, today]);

  const { loading: chainLoading, error: chainError, chainByExpiry, spot } = useChainByExpiry(selected, targetExpiries);

  const result = useMemo(() => {
    if (!earningsIso || !selected || !spot) return null;
    return buildEarningsPaths({
      ticker: selected,
      earningsIso,
      todayIso: today,
      spot,
      conviction,
      chainByExpiry,
    });
  }, [selected, earningsIso, today, spot, conviction, chainByExpiry]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Ticker picker + conviction */}
      <Frame accent="warn" title="EARNINGS PLAY TOOL"
        subtitle="Four Ryan Hildreth CSP paths around a scheduled earnings event"
        right={<ConvictionPicker value={conviction} onChange={setConviction} />}
      >
        {uniLoading ? (
          <div style={{ fontSize: T.sm, color: T.tm, fontFamily: T.mono }}>Loading earnings calendar…</div>
        ) : uniError ? (
          <Empty glyph="✕" accent="amber" compact title="Couldn't load earnings calendar." body={uniError} />
        ) : !uniRows.length ? (
          <Empty glyph="∅" accent="quiet" compact
            title="No upcoming earnings in the wheel universe."
            body="Earnings dates are refreshed daily from Yahoo Finance. Check back later." />
        ) : (
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: T.xs, color: T.tm, fontFamily: T.mono, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Ticker
              <select
                value={selected || ""}
                onChange={e => setSelected(e.target.value)}
                style={{
                  background: T.bg, color: T.t1, border: `1px solid ${T.bd}`,
                  fontFamily: T.mono, fontSize: T.sm, padding: "5px 10px", borderRadius: T.rSm,
                }}
              >
                {uniRows.map(r => {
                  const d = daysBetween(today, r.date);
                  return <option key={r.ticker} value={r.ticker}>{r.ticker} · {r.date} · {d}d</option>;
                })}
              </select>
            </label>
            {picked && (
              <span style={{ fontSize: T.xs, color: T.ts, fontFamily: T.mono }}>
                {uniRows.length} upcoming events in approved universe
              </span>
            )}
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
            <Empty glyph="∅" accent="quiet" compact
              title="No data yet."
              body="Pick a ticker with upcoming earnings to see the expected move." />
          ) : (
            <ExpectedMoveBar em={result.expectedMove} spot={spot} earningsIso={earningsIso} />
          )}
        </Frame>
      )}

      {/* Four paths */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionLabel label="FOUR PATHS" right={`${conviction} conviction`} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            <PathCard id="A" path={result.paths.A} />
            <PathCard id="B" path={result.paths.B} />
            <PathCard id="C" path={result.paths.C} />
            <PathCard id="D" path={result.paths.D} />
          </div>
        </div>
      )}
    </div>
  );
}
