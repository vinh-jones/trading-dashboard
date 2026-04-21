import { useState, useMemo, useEffect } from "react";
import { T, getVixBand } from "../../theme.js";
import { Frame, Empty } from "../../primitives.jsx";
import { useRadar } from "../../../hooks/useRadar.js";
import { getDeployContext, clearDeployContext } from "../focus/DeployBlock.jsx";
import {
  DEFAULT_FILTERS,
  applyRadarFilters,
  useRadarPresets,
  RadarFilterBar,
} from "./RadarFilters.jsx";

// ── Score computation (mirrors RadarTab.jsx) ──────────────────────────────────
function compositeIv(iv, ivRank) {
  if (iv == null || ivRank == null) return null;
  return (ivRank / 100 * 0.60) + (Math.min(iv / 1.50, 1.0) * 0.40);
}
function scannerScore(bbPosition, iv, ivRank) {
  if (bbPosition == null) return null;
  const ivComp = compositeIv(iv, ivRank);
  if (ivComp == null) return null;
  return (1 - bbPosition) * 0.50 + ivComp * 0.50;
}

// ── Data adapter: useRadar row → design r shape ───────────────────────────────
function toBBEnum(pos) {
  if (pos == null) return "mid";
  if (pos < 0)    return "below";
  if (pos < 0.20) return "near_lower";
  if (pos < 0.80) return "mid";
  if (pos < 1.0)  return "near_upper";
  return "above";
}
function toTemplate(bbPos, ivr) {
  if (bbPos == null || ivr == null) return "weak";
  if (bbPos < 0.25 && ivr > 0.50) return "strong";
  if (bbPos < 0.45 || ivr > 0.50) return "moderate";
  return "weak";
}
function sampleCSP(row) {
  if (!row.last || !row.iv) return null;
  const strike = row.bb_lower
    ? Math.floor(row.bb_lower)
    : Math.floor(row.last * 0.95);
  const T30 = Math.sqrt(30 / 252);
  const prem = parseFloat((strike * (row.iv / 100) * T30 * 0.38).toFixed(2));
  const coll = strike * 100;
  const ror  = prem > 0 ? parseFloat(((prem / coll) * 100).toFixed(2)) : 0;
  return { strike, prem, ror, coll };
}
function adaptRow(row, positions, accountValue, earningsMap, bookSet) {
  const score0to1 = scannerScore(row.bb_position, row.iv, row.iv_rank);
  const score     = score0to1 != null ? Math.round(score0to1 * 100) : null;
  const bbPct     = row.bb_position;
  const bb        = toBBEnum(bbPct);
  const ivr       = row.iv_rank != null ? row.iv_rank / 100 : null;
  const iv        = row.iv != null ? row.iv / 100 : null;

  // Concentration: positions for this ticker / account value
  let conc = 0;
  if (accountValue > 0 && positions) {
    let committed = 0;
    for (const p of positions.open_csps || []) {
      if (p.ticker === row.ticker) committed += (p.strike || 0) * (p.contracts || 1) * 100;
    }
    for (const s of positions.assigned_shares || []) {
      if (s.ticker === row.ticker) committed += s.cost_basis_total || 0;
    }
    conc = parseFloat(((committed / accountValue) * 100).toFixed(1));
  }

  // Days until next earnings. Prefer OpenClaw's richer per-ticker data (from
  // marketContext.positions[].nextEarnings — only held tickers), fall back to
  // OpenClaw wheel earnings (quotes.earnings_date + earnings_meta) and finally
  // the Yahoo lazy fallback in /api/wheel-earnings.
  let earn = null;
  let earnHour = null;
  const mcEntry = earningsMap?.[row.ticker];
  const earnIso = (typeof mcEntry === "object" ? mcEntry.date : mcEntry) ?? row.earnings_date;
  if (earnIso) {
    const days = Math.ceil((new Date(earnIso + "T00:00:00") - new Date()) / 86400000);
    if (days >= 0 && days < 400) earn = days;
    earnHour = (typeof mcEntry === "object" && mcEntry?.time)
      ? mcEntry.time
      : row.earnings_meta?.hour ?? null;
  }

  // Intraday % change from yesterday's close (populated by /api/bb alongside BB data)
  const chg = (row.last != null && row.prev_close != null && row.prev_close !== 0)
    ? ((row.last - row.prev_close) / row.prev_close) * 100
    : null;

  return {
    t:        row.ticker,
    ticker:   row.ticker,
    sector:   row.sector || "—",
    score,
    bbPct:    bbPct ?? 0.5,
    bb_position: bbPct,           // raw 0..1 scale for filters
    bb,
    ivr:      ivr ?? 0,
    iv:       iv ?? 0,
    iv_rank:  row.iv_rank ?? null, // 0..100 for filters
    iv_pct:   row.iv ?? null,      // 0..100 for filters
    earn,
    earnHour,
    conc,
    px:       row.last,
    chg,
    pe:       row.pe_ttm ?? null,
    held:     bookSet ? bookSet.has(row.ticker) : false,
    template: toTemplate(bbPct, ivr),
    sample:   sampleCSP(row),
  };
}

// ── BB visual metadata ────────────────────────────────────────────────────────
const BB_META = {
  below:      { color: T.green, label: "BELOW"   },
  near_lower: { color: T.green, label: "NEAR ↓" },
  mid:        { color: T.tm,    label: "MID"     },
  near_upper: { color: T.red,   label: "NEAR ↑" },
  above:      { color: T.red,   label: "ABOVE"   },
};
const TEMPLATE_META = {
  strong:          { color: T.green, label: "STRONG · PRIMARY CSP"       },
  moderate:        { color: T.amber, label: "MODERATE · SELECTIVE"        },
  weak:            { color: T.tm,    label: "WEAK · SKIP"                 },
  "earnings-hold": { color: T.mag,   label: "HOLD · INSIDE EARNINGS"      },
};

// ── Main surface ──────────────────────────────────────────────────────────────
export function RadarSurface({ positions, account, marketContext }) {
  const { rows: rawRows, loading, error } = useRadar();
  const { presets, savePreset, deletePreset } = useRadarPresets();
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState("score");
  const [deployCtx, setDeployCtx] = useState(() => getDeployContext());

  // On mount, honor a deploy-context handoff from Focus
  useEffect(() => {
    const ctx = getDeployContext();
    if (!ctx) return;
    setDeployCtx(ctx);
    if (ctx.bookOnly) setFilters(prev => ({ ...prev, ownership: "held" }));
    if (ctx.ticker)   setSelected(ctx.ticker);
  }, []);

  const clearDeploy = () => {
    clearDeployContext();
    setDeployCtx(null);
    setFilters(prev => ({ ...prev, ownership: "all" }));
  };

  const bookSet = useMemo(() => {
    const set = new Set();
    (positions?.open_csps       || []).forEach(p => p.ticker && set.add(p.ticker));
    (positions?.assigned_shares || []).forEach(s => s.ticker && set.add(s.ticker));
    (positions?.open_leaps      || []).forEach(l => l.ticker && set.add(l.ticker));
    return set;
  }, [positions]);

  const accountValue = account?.account_value ?? 0;
  const vix          = account?.vix_current ?? null;
  const vixBand      = vix != null ? getVixBand(vix) : null;
  const sentiment    = vixBand?.sentiment ?? null;

  // Earnings lookup by ticker — sourced from marketContext.positions (Finnhub
  // per-ticker dates, richer metadata including bmo/amc hour + estimates).
  // Only covers tickers we hold; full universe falls back to quotes.earnings_*.
  const earningsMap = useMemo(() => {
    const map = {};
    (marketContext?.positions || []).forEach(p => {
      if (p.ticker && p.nextEarnings?.date) {
        map[p.ticker] = {
          date: p.nextEarnings.date.slice(0, 10),
          time: p.nextEarnings.time ?? null,
          epsEstimate: p.nextEarnings.epsEstimate ?? null,
        };
      }
    });
    return map;
  }, [marketContext]);

  const rows = useMemo(() => {
    const adapted = rawRows
      .map(r => adaptRow(r, positions, accountValue, earningsMap, bookSet))
      .filter(r => r.score != null);
    return applyRadarFilters(adapted, filters, sortKey);
  }, [rawRows, filters, sortKey, bookSet, positions, accountValue, earningsMap]);

  if (loading) {
    return (
      <Frame accent="radar" title="RADAR" subtitle="loading…">
        <div style={{ padding: "40px 20px", textAlign: "center", color: T.tf, fontSize: T.sm, fontFamily: T.mono, letterSpacing: "0.08em" }}>
          SCANNING UNIVERSE…
        </div>
      </Frame>
    );
  }
  if (error) {
    const devMsg = !import.meta.env.PROD
      ? "Radar requires Supabase credentials. Add VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY to .env.local to test locally."
      : error;
    return (
      <Frame accent="radar" title="RADAR" subtitle="unavailable">
        <div style={{ padding: "20px", color: T.tf, fontSize: T.sm, fontFamily: T.mono, lineHeight: 1.6 }}>
          {devMsg}
        </div>
      </Frame>
    );
  }
  if (rawRows.length === 0) {
    return (
      <Frame accent="radar" title="RADAR" subtitle="no data">
        <Empty glyph="▸_" accent="radar" compact title="No radar data." body="Wheel universe and quotes load from Supabase. Check that wheel_universe and quotes tables are populated." />
      </Frame>
    );
  }

  const selectedRow = selected ? rows.find(r => r.t === selected) ?? null : null;
  const showDetail = !!selectedRow;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: showDetail ? "minmax(0,1fr) 360px" : "minmax(0,1fr)",
      gap: 14,
      alignItems: "start",
    }}>
      {/* Left: optional deploy banner + filter bar + list */}
      <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
        {deployCtx && filters.ownership === "held" && (
          <DeployBanner ctx={deployCtx} bookCount={bookSet.size} totalCount={rawRows.length} onClear={clearDeploy} />
        )}
        <RadarFilterBar
          filters={filters} setFilters={setFilters}
          sortKey={sortKey} setSortKey={setSortKey}
          presets={presets} savePreset={savePreset} deletePreset={deletePreset}
        />
        <RadarList rows={rows} total={rawRows.length} vix={vix} sentiment={sentiment} selected={selected} setSelected={setSelected} />
      </div>

      {/* Right: detail panel */}
      {showDetail && (
        <RadarDetail r={selectedRow} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ── Deploy context banner ─────────────────────────────────────────────────────
function DeployBanner({ ctx, bookCount, totalCount, onClear }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
      background: T.cyan + "0f", border: `1px solid ${T.cyan}55`, borderRadius: T.rSm,
    }}>
      <span style={{ fontSize: T.xs, color: T.cyan, letterSpacing: "0.15em", fontWeight: 700, fontFamily: T.mono }}>
        ◂ FROM DEPLOY
      </span>
      <span style={{ fontSize: T.sm, color: T.tm, fontFamily: T.mono }}>
        Showing your book — {bookCount} tickers
        {ctx.ticker && <span style={{ color: T.t1, marginLeft: 6 }}>· opened {ctx.ticker}</span>}
      </span>
      <span style={{ flex: 1 }} />
      <button
        onClick={onClear}
        style={{
          fontSize: T.xs, color: T.tm, border: `1px solid ${T.bd}`, background: "transparent",
          padding: "3px 10px", letterSpacing: "0.1em", borderRadius: T.rSm,
          fontFamily: T.mono, cursor: "pointer",
        }}
      >
        SHOW ALL {totalCount} ▸
      </button>
    </div>
  );
}


// ── Row list ──────────────────────────────────────────────────────────────────
const ROW_COLS = "44px 1fr 110px 88px 70px 92px 90px 48px";

function RadarList({ rows, total, vix, sentiment, selected, setSelected }) {
  const subtitle = [
    `${rows.length}/${total} tickers`,
    vix != null ? `VIX ${vix.toFixed(2)}` : null,
    sentiment,
  ].filter(Boolean).join(" · ");

  return (
    <Frame accent="radar" title="RADAR" subtitle={subtitle}>
      {/* Column header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: ROW_COLS,
        gap: 14, padding: "4px 8px",
        fontSize: T.xs, color: T.tf, letterSpacing: "0.15em",
        borderBottom: `1px solid ${T.bd}`,
      }}>
        <span>SCORE</span>
        <span>TKR / PX / NARRATIVE</span>
        <span>BB 20/2σ</span>
        <span>IV RANK</span>
        <span>RAW IV</span>
        <span>EARN</span>
        <span style={{ textAlign: "right" }}>CONC</span>
        <span></span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: "40px 20px", textAlign: "center", color: T.tf, fontSize: T.sm, fontFamily: T.mono }}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>∅</div>
          NO TICKERS MATCH
        </div>
      ) : rows.map(r => (
        <RadarRow
          key={r.t}
          r={r}
          selected={selected === r.t}
          onClick={() => setSelected(selected === r.t ? null : r.t)}
        />
      ))}
    </Frame>
  );
}

// ── Radar row ─────────────────────────────────────────────────────────────────
function RadarRow({ r, selected, onClick }) {
  const [hover, setHover] = useState(false);
  const bbInfo = BB_META[r.bb] || BB_META.mid;
  const tpl    = TEMPLATE_META[r.template] || TEMPLATE_META.weak;
  const scoreColor = r.score >= 80 ? T.green : r.score >= 65 ? T.amber : T.ts;
  const insideEarn = r.earn != null && r.earn <= 21;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: ROW_COLS,
        gap: 14, alignItems: "center",
        padding: "12px 8px",
        borderBottom: `1px solid ${T.hair}`,
        borderLeft: `2px solid ${selected ? T.cyan : tpl.color + (hover ? "" : "00")}`,
        background: selected ? T.cyan + "0a" : hover ? T.elev + "60" : "transparent",
        cursor: "pointer",
        transition: "background 0.12s",
        minWidth: 0,
      }}
    >
      {/* Score */}
      <div style={{ fontSize: 18, fontWeight: 600, color: scoreColor, fontFamily: T.mono, letterSpacing: "-0.02em" }}>
        {r.score ?? "—"}
      </div>

      {/* Ticker + price + change% + narrative */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: T.md, color: T.t1, fontWeight: 600, letterSpacing: "0.02em" }}>{r.t}</span>
          {r.px != null && (
            <span style={{ fontSize: T.sm, color: T.ts, fontFamily: T.mono }}>
              ${r.px.toFixed(2)}
              {r.chg != null && (
                <span style={{ color: r.chg >= 0 ? T.green : T.red, marginLeft: 6 }}>
                  {r.chg > 0 ? "+" : ""}{r.chg.toFixed(1)}%
                </span>
              )}
            </span>
          )}
          <span style={{ fontSize: T.xs, color: tpl.color, letterSpacing: "0.12em", fontWeight: 600 }}>{tpl.label}</span>
        </div>
      </div>

      {/* BB Gauge */}
      <div>
        <BBGauge pct={r.bbPct} />
        <div style={{ fontSize: T.xs, color: bbInfo.color, letterSpacing: "0.08em", marginTop: 4 }}>{bbInfo.label}</div>
      </div>

      {/* IV Rank */}
      <div>
        <div style={{
          fontSize: T.sm, fontFamily: T.mono,
          color: r.ivr >= 0.70 ? T.green : r.ivr >= 0.50 ? T.amber : T.ts,
        }}>
          {(r.ivr * 100).toFixed(0)}<span style={{ color: T.tf, fontSize: T.xs }}> / 100</span>
        </div>
        <div style={{ height: 2, background: T.bd, marginTop: 4, borderRadius: 1, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${r.ivr * 100}%`,
            background: r.ivr >= 0.70 ? T.green : r.ivr >= 0.50 ? T.amber : T.blueB,
          }} />
        </div>
      </div>

      {/* Raw IV */}
      <div>
        <div style={{ fontSize: T.sm, color: T.t2, fontFamily: T.mono }}>
          {(r.iv * 100).toFixed(0)}<span style={{ color: T.tf, fontSize: T.xs }}>%</span>
        </div>
        <div style={{ fontSize: T.xs, color: T.tf, marginTop: 2 }}>
          {r.iv >= 0.80 ? "very high" : r.iv >= 0.60 ? "high" : r.iv >= 0.40 ? "mid" : "low"}
        </div>
      </div>

      {/* Earnings */}
      <div>
        {r.earn != null ? (
          <>
            <div style={{ fontSize: T.sm, color: insideEarn ? T.mag : T.ts, fontFamily: T.mono }}>
              {r.earn}d
              {insideEarn && (
                <span style={{ fontSize: T.xs, color: T.mag, letterSpacing: "0.1em", marginLeft: 4 }}>HOLD</span>
              )}
            </div>
            <div style={{ fontSize: T.xs, color: T.tf, marginTop: 2 }}>
              {insideEarn ? "inside 21d" : "clear"}
              {r.earnHour && r.earnHour !== "" && (
                <span style={{ color: T.ts, marginLeft: 4 }}>
                  · {r.earnHour.toLowerCase() === "bmo" ? "bmo" : r.earnHour.toLowerCase() === "amc" ? "amc" : r.earnHour}
                </span>
              )}
            </div>
          </>
        ) : (
          <div style={{ fontSize: T.sm, color: T.tf, fontFamily: T.mono }}>—</div>
        )}
      </div>

      {/* Concentration */}
      <div style={{ textAlign: "right" }}>
        <div style={{
          fontSize: T.sm, fontFamily: T.mono,
          color: r.conc >= 15 ? T.red : r.conc >= 10 ? T.amber : T.ts,
        }}>
          {r.conc > 0 ? `${r.conc.toFixed(1)}%` : "—"}
        </div>
        {r.conc >= 15 && <div style={{ fontSize: T.xs, color: T.red, letterSpacing: "0.1em" }}>CEILING</div>}
        {r.conc >= 10 && r.conc < 15 && <div style={{ fontSize: T.xs, color: T.amber, letterSpacing: "0.1em" }}>TARGET</div>}
      </div>

      {/* Chevron */}
      <div style={{ textAlign: "right", fontSize: T.sm, color: selected ? T.cyan : T.tf }}>
        {selected ? "◂" : "▸"}
      </div>
    </div>
  );
}

// ── BB Gauge ──────────────────────────────────────────────────────────────────
function BBGauge({ pct }) {
  const clamped = Math.max(-0.3, Math.min(1.3, pct));
  const left    = ((clamped + 0.3) / 1.6) * 100;
  return (
    <div style={{ position: "relative", height: 6, background: T.bd, borderRadius: 1 }}>
      <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${(0.3/1.6)*100}%`, background: T.green + "55" }} />
      <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: `${(0.3/1.6)*100}%`, background: T.red + "55" }} />
      <div style={{ position: "absolute", top: -2, bottom: -2, left: `${((0.3 + 0.5)/1.6)*100}%`, width: 1, background: T.tf }} />
      <div style={{
        position: "absolute", top: -3, bottom: -3,
        left: `${left}%`, width: 2,
        background: pct < 0 ? T.green : pct > 1 ? T.red : T.amber,
        boxShadow: `0 0 5px ${pct < 0 ? T.green : pct > 1 ? T.red : T.amber}`,
      }} />
    </div>
  );
}

// ── Score dial (SVG) ──────────────────────────────────────────────────────────
function ScoreDial({ score }) {
  const size = 76, rad = 30, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * rad;
  const frac = (score ?? 0) / 100;
  const color = score >= 80 ? T.green : score >= 65 ? T.amber : T.ts;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={rad} stroke={T.bd} strokeWidth="4" fill="none" />
      <circle cx={cx} cy={cy} r={rad} stroke={color} strokeWidth="4" fill="none"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - frac)}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
        fill={T.t1} style={{ fontFamily: T.mono, fontSize: 18, fontWeight: 600 }}>
        {score ?? "—"}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle"
        fill={T.tm} style={{ fontFamily: T.mono, fontSize: 7, letterSpacing: "0.14em" }}>
        SCORE
      </text>
    </svg>
  );
}

// ── Mini gauge ────────────────────────────────────────────────────────────────
function MiniGauge({ label, value, fmt, color }) {
  return (
    <div style={{ padding: 10, background: T.bg, border: `1px solid ${T.bd}` }}>
      <div style={{ fontSize: T.xs, letterSpacing: "0.14em", color: T.tm }}>{label}</div>
      <div style={{ fontSize: 17, color, fontFamily: T.mono, marginTop: 4 }}>{fmt(value)}</div>
    </div>
  );
}

// ── Radar detail panel ────────────────────────────────────────────────────────
function RadarDetail({ r, onClose }) {
  const tpl    = TEMPLATE_META[r.template] || TEMPLATE_META.weak;
  const bbInfo = BB_META[r.bb] || BB_META.mid;

  return (
    <Frame
      accent="radar"
      title={`DETAIL · ${r.t}`}
      subtitle={tpl.label}
      right={
        <button onClick={onClose} style={{
          fontSize: T.xs, color: T.tm, border: `1px solid ${T.bd}`,
          background: "transparent", padding: "2px 8px", cursor: "pointer",
          fontFamily: T.mono,
        }}>✕</button>
      }
    >
      {/* Price + score dial */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "start" }}>
        <div>
          {r.px != null ? (
            <div style={{ fontSize: 28, color: T.t1, fontWeight: 300, fontFamily: T.mono, letterSpacing: "-0.02em" }}>
              ${r.px.toFixed(2)}
            </div>
          ) : (
            <div style={{ fontSize: 20, color: T.tf, fontFamily: T.mono }}>—</div>
          )}
          <div style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono, marginTop: 6, letterSpacing: "0.08em" }}>
            P/E (TTM) <span style={{ color: T.tm }}>{r.pe != null ? r.pe.toFixed(1) : "—"}</span>
            <span style={{ color: T.bd, margin: "0 6px" }}>·</span>
            SECTOR <span style={{ color: T.tm }}>{r.sector}</span>
          </div>
        </div>
        <ScoreDial score={r.score} />
      </div>

      {/* Narrative */}
      <div style={{
        marginTop: 14, padding: 12,
        background: T.bg, border: `1px solid ${T.bd}`,
        borderLeft: `3px solid ${tpl.color}`,
        fontSize: T.sm, lineHeight: 1.6, color: T.t2,
      }}>
        <div style={{ color: tpl.color, letterSpacing: "0.1em", fontSize: T.xs, fontWeight: 600, marginBottom: 6 }}>
          ▸ NARRATIVE
        </div>
        BB <span style={{ color: bbInfo.color }}>{bbInfo.label.toLowerCase()}</span> with IVR{" "}
        <span style={{ color: r.ivr >= 0.70 ? T.green : T.amber }}>
          {(r.ivr * 100).toFixed(0)}
        </span>
        {r.template === "strong" && " — primary CSP zone. Strike at or below the lower band gets you paid for the bounce."}
        {r.template === "moderate" && " — selective. Wait for a dip or take starter size."}
        {r.template === "weak" && " — weak setup. Skip or wait for IV expansion."}
        {" "}Concentration{" "}
        <span style={{ color: r.conc >= 10 ? T.amber : T.ts }}>
          {r.conc > 0 ? `${r.conc.toFixed(1)}%` : "—"}
        </span>
        {r.conc >= 15 ? " — at ceiling, do not add." : r.conc >= 10 ? " — above target, trim-first mode." : " — room to add."}
      </div>

      {/* Mini gauges */}
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <MiniGauge
          label="BB POS"
          value={r.bbPct}
          fmt={v => v.toFixed(2)}
          color={bbInfo.color}
        />
        <MiniGauge
          label="IV RANK"
          value={r.ivr}
          fmt={v => (v * 100).toFixed(0)}
          color={r.ivr >= 0.70 ? T.green : T.amber}
        />
        <MiniGauge
          label="RAW IV"
          value={r.iv}
          fmt={v => (v * 100).toFixed(0) + "%"}
          color={r.iv >= 0.70 ? T.t1 : T.t2}
        />
      </div>

      {/* CSP sample */}
      {r.sample ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: T.xs, letterSpacing: "0.14em", color: T.tm, marginBottom: 6 }}>
            ▸ CSP SAMPLE · 30DTE · ≈30δ · est.
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: 8, padding: 12,
            background: T.bg, border: `1px solid ${T.bd}`,
          }}>
            <SampleDatum label="STRIKE" v={`$${r.sample.strike}`} />
            <SampleDatum label="PREM" v={`$${r.sample.prem.toFixed(2)}`} color={T.green} />
            <SampleDatum label="ROR" v={`${r.sample.ror.toFixed(2)}%`} color={T.cyan} />
            <SampleDatum label="CAPITAL" v={`$${r.sample.coll.toLocaleString()}`} />
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 14, fontSize: T.sm, color: T.tf, fontFamily: T.mono }}>
          Sample unavailable — missing price or IV data.
        </div>
      )}

      {/* Concentration note */}
      {r.conc > 0 && (
        <div style={{ marginTop: 10, fontSize: T.xs, color: T.tf, fontFamily: T.mono, letterSpacing: "0.06em" }}>
          Current exposure: {r.conc.toFixed(1)}% of account · 10% pos / 15% sector targets.
        </div>
      )}
    </Frame>
  );
}

function SampleDatum({ label, v, color }) {
  return (
    <div>
      <div style={{ fontSize: T.xs, color: T.tf, letterSpacing: "0.1em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color: color || T.t1, fontFamily: T.mono, fontWeight: 500 }}>{v}</div>
    </div>
  );
}
