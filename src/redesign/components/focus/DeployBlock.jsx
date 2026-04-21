import { useState, useEffect } from "react";
import { T } from "../../theme.js";
import { Frame } from "../../primitives.jsx";
import { useRadar } from "../../../hooks/useRadar.js";
import { calcDTE, buildOccSymbol } from "../../../lib/trading.js";
import { targetProfitPctForDtePct, proximityFraction } from "../../../lib/positionAttention.js";
import { openPosition } from "../PositionDetail.jsx";

// ── Pin state (localStorage, 7-day decay) ──────────────────────────────────────
const PINS_KEY      = "tw-deploy-pins-v1";
const CONTEXT_KEY   = "tw-deploy-context";
const MAX_PIN_AGE_MS = 7 * 24 * 3600 * 1000;

function loadPins() {
  try {
    const raw = JSON.parse(localStorage.getItem(PINS_KEY) || "[]");
    const now = Date.now();
    return raw.filter(p => (now - p.ts) < MAX_PIN_AGE_MS);
  } catch { return []; }
}

function usePins() {
  const [pins, setPins] = useState(loadPins);
  const toggle = (ticker) => {
    const next = pins.some(p => p.t === ticker)
      ? pins.filter(p => p.t !== ticker)
      : [...pins, { t: ticker, ts: Date.now() }];
    setPins(next);
    try { localStorage.setItem(PINS_KEY, JSON.stringify(next)); } catch {}
  };
  return { pins, toggle, isPinned: (t) => pins.some(p => p.t === t) };
}

// ── Deploy context handoff (sessionStorage) ────────────────────────────────────
export function setDeployContext(ctx) {
  try { sessionStorage.setItem(CONTEXT_KEY, JSON.stringify(ctx)); } catch {}
}
export function getDeployContext() {
  try { return JSON.parse(sessionStorage.getItem(CONTEXT_KEY) || "null"); }
  catch { return null; }
}
export function clearDeployContext() {
  try { sessionStorage.removeItem(CONTEXT_KEY); } catch {}
}

function gotoRadar({ ticker, bookOnly } = {}) {
  setDeployContext({ bookOnly: bookOnly ?? true, ticker: ticker || null, ts: Date.now() });
  window.dispatchEvent(new CustomEvent("tw-goto", { detail: { surface: "explore", mode: "radar" } }));
}

// ── "Book" = tickers we currently hold or have ever traded ─────────────────────
function buildBookSet(positions, trades) {
  const set = new Set();
  (positions?.open_csps       || []).forEach(p => p.ticker && set.add(p.ticker));
  (positions?.assigned_shares || []).forEach(s => s.ticker && set.add(s.ticker));
  (positions?.open_leaps      || []).forEach(l => l.ticker && set.add(l.ticker));
  (trades || []).forEach(t => t.ticker && set.add(t.ticker));
  return set;
}

// Per-ticker YTD stats from trades
function buildFavMeta(trades) {
  const year = new Date().getFullYear();
  const map = {};
  (trades || []).forEach(t => {
    if (!t.ticker) return;
    const closeDate = t.close_date || t.open_date;
    if (!closeDate) return;
    const y = parseInt(closeDate.slice(0, 4), 10);
    if (y !== year) return;
    const entry = map[t.ticker] || { trades: 0, ytdPl: 0 };
    entry.trades += 1;
    entry.ytdPl  += t.premium_collected ?? t.premium ?? 0;
    map[t.ticker] = entry;
  });
  return map;
}

// ── Adapter: useRadar row → display row with score/bb/template ─────────────────
function compositeIv(iv, ivRank) {
  if (iv == null || ivRank == null) return null;
  return (ivRank / 100 * 0.60) + (Math.min(iv / 1.50, 1.0) * 0.40);
}
function scoreOf(r) {
  if (r.bb_position == null) return null;
  const ivComp = compositeIv(r.iv, r.iv_rank);
  if (ivComp == null) return null;
  return Math.round(((1 - r.bb_position) * 0.50 + ivComp * 0.50) * 100);
}
function bbEnum(pos) {
  if (pos == null) return "mid";
  if (pos < 0)     return "below";
  if (pos < 0.20)  return "near_lower";
  if (pos < 0.80)  return "mid";
  if (pos < 1.0)   return "near_upper";
  return "above";
}
function templateOf(r) {
  const ivr = r.iv_rank != null ? r.iv_rank / 100 : null;
  if (r.bb_position == null || ivr == null) return "weak";
  if (r.bb_position < 0.25 && ivr > 0.50) return "strong";
  if (r.bb_position < 0.45 || ivr > 0.50) return "moderate";
  return "weak";
}

function candidateWhy(r) {
  const parts = [];
  const bb = bbEnum(r.bb_position);
  if (bb === "below")      parts.push("below 2σ");
  else if (bb === "near_lower") parts.push("near lower band");
  if (r.iv_rank >= 70)     parts.push(`IVR ${Math.round(r.iv_rank)}`);
  if (r.earnDays != null && r.earnDays > 40) parts.push(`earn ${r.earnDays}d clear`);
  else if (r.earnDays != null && r.earnDays > 21) parts.push(`earn ${r.earnDays}d`);
  return parts.slice(0, 3).join(" · ");
}

// Weighted rank of candidates (template × BB × IVR)
function rankCandidates(rows, bookSet, favMeta, earningsMap, n) {
  const tplW = { strong: 1.0, moderate: 0.6, weak: 0.2 };
  const bbW  = { below: 1.0, near_lower: 0.75, mid: 0.3, near_upper: 0.1, above: 0.0 };

  return rows
    .filter(r => bookSet.has(r.ticker))
    .map(r => {
      const score   = scoreOf(r);
      const bb      = bbEnum(r.bb_position);
      const tpl     = templateOf(r);
      const ivr     = r.iv_rank != null ? r.iv_rank / 100 : 0;
      const earnIso = earningsMap?.[r.ticker];
      const earnDays = earnIso
        ? Math.ceil((new Date(earnIso + "T00:00:00") - new Date()) / 86400000)
        : null;
      // Earnings-hold → template swap
      const effTpl = (earnDays != null && earnDays >= 0 && earnDays <= 21) ? "earnings-hold" : tpl;
      const fav    = favMeta[r.ticker];
      const favScore = fav ? Math.min(1, fav.trades / 10) : 0.3;
      const weight = favScore * (tplW[effTpl] ?? 0) * (bbW[bb] ?? 0.3) * (0.5 + ivr * 0.5);
      return { ticker: r.ticker, score, bb, template: effTpl, earnDays, iv_rank: r.iv_rank, bb_position: r.bb_position, weight, fav };
    })
    .filter(c => c.score != null && c.weight > 0 && c.template !== "earnings-hold")
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n);
}

// ── Deploy block — shown when free cash exceeds VIX band ceiling ──────────────
export function DeployBlock({ account, positions, trades, marketContext, band }) {
  const { rows: radarRows } = useRadar();
  const { pins, toggle, isPinned } = usePins();

  const accountValue = account?.account_value ?? 0;
  const freePct      = account?.free_cash_pct_est ?? account?.free_cash_pct ?? 0;
  const headroom     = band ? freePct - band.ceilingPct : 0;
  const targetRoom   = Math.round((headroom * accountValue) / 1000) * 1000;

  const bookSet    = buildBookSet(positions, trades);
  const favMeta    = buildFavMeta(trades);
  const earningsMap = {};
  (marketContext?.positions || []).forEach(p => {
    if (p.ticker && p.nextEarnings?.date) earningsMap[p.ticker] = p.nextEarnings.date.slice(0, 10);
  });

  const candidates = rankCandidates(radarRows || [], bookSet, favMeta, earningsMap, 3);
  const pinnedRows = pins
    .map(p => {
      const radar = (radarRows || []).find(r => r.ticker === p.t);
      if (!radar) return null;
      return {
        ticker: p.t,
        score: scoreOf(radar),
        bb: bbEnum(radar.bb_position),
        template: templateOf(radar),
        iv_rank: radar.iv_rank,
        bb_position: radar.bb_position,
        earnDays: earningsMap[p.t]
          ? Math.ceil((new Date(earningsMap[p.t] + "T00:00:00") - new Date()) / 86400000)
          : null,
        fav: favMeta[p.t],
      };
    })
    .filter(Boolean)
    .filter(p => !bookSet.has(p.ticker)); // don't dupe "book" tickers in pinned section

  return (
    <Frame
      accent="quiet"
      title="▸ DEPLOY"
      subtitle={
        targetRoom > 0
          ? `$${(targetRoom / 1000).toFixed(0)}k under ceiling · band ${band.label} targets ${Math.round(band.floorPct * 100)}–${Math.round(band.ceilingPct * 100)}%`
          : `within VIX band · targets ${Math.round(band.floorPct * 100)}–${Math.round(band.ceilingPct * 100)}%`
      }
      right={
        <button
          onClick={() => gotoRadar({ bookOnly: true })}
          style={{
            fontSize: T.xs, color: T.cyan, border: `1px solid ${T.cyan}66`,
            background: T.cyan + "10", padding: "4px 11px",
            letterSpacing: "0.12em", borderRadius: T.rSm, fontFamily: T.mono,
            cursor: "pointer",
          }}
        >
          OPEN RADAR ▸
        </button>
      }
    >
      {candidates.length > 0 ? (
        <>
          <div style={{ fontSize: T.xs, letterSpacing: "0.15em", color: T.tm, marginBottom: 8, fontFamily: T.mono }}>
            ▸ TOP CANDIDATES · YOUR BOOK
          </div>
          <div style={{ display: "grid", gap: 1, background: T.bd, border: `1px solid ${T.bd}`, borderRadius: T.rSm }}>
            {candidates.map(r => (
              <CandidateRow
                key={r.ticker} r={r}
                onClick={() => gotoRadar({ ticker: r.ticker })}
                pinned={isPinned(r.ticker)}
                onPin={(e) => { e.stopPropagation(); toggle(r.ticker); }}
                showFavMeta
              />
            ))}
          </div>
        </>
      ) : (
        <div style={{ fontSize: T.sm, color: T.tm, lineHeight: 1.6, fontFamily: T.mono, padding: "4px 0" }}>
          No ranked candidates from your book yet. Open Radar to explore the full wheel universe.
        </div>
      )}

      {pinnedRows.length > 0 && (
        <>
          <div style={{ fontSize: T.xs, letterSpacing: "0.15em", color: T.tm, marginTop: 14, marginBottom: 8, fontFamily: T.mono }}>
            ⌖ PINNED <span style={{ color: T.tf }}>· manual · decays 7d</span>
          </div>
          <div style={{ display: "grid", gap: 1, background: T.bd, border: `1px solid ${T.bd}`, borderRadius: T.rSm }}>
            {pinnedRows.map(r => (
              <CandidateRow
                key={r.ticker} r={r}
                onClick={() => gotoRadar({ ticker: r.ticker })}
                pinned
                onPin={(e) => { e.stopPropagation(); toggle(r.ticker); }}
              />
            ))}
          </div>
        </>
      )}
    </Frame>
  );
}

function CandidateRow({ r, onClick, pinned, onPin, showFavMeta }) {
  const [hover, setHover] = useState(false);
  const why = candidateWhy(r);
  const scoreColor = r.score >= 80 ? T.green : r.score >= 65 ? T.amber : T.ts;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid", gridTemplateColumns: "56px 1fr auto auto", gap: 12, alignItems: "center",
        padding: "10px 12px",
        background: hover ? T.elev : T.surf,
        cursor: "pointer", transition: "background 0.12s",
      }}
    >
      <span style={{ fontSize: T.md, fontWeight: 600, color: T.t1 }}>{r.ticker}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: T.sm, color: T.tm, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {why || <span style={{ color: T.tf }}>—</span>}
        </div>
        {showFavMeta && r.fav && (
          <div style={{ fontSize: T.xs, color: T.tf, marginTop: 2, fontFamily: T.mono, letterSpacing: "0.05em" }}>
            YTD {r.fav.trades}× · {r.fav.ytdPl >= 0 ? "+" : "−"}${Math.abs(r.fav.ytdPl / 1000).toFixed(1)}k
          </div>
        )}
      </div>
      <div style={{ textAlign: "right", fontFamily: T.mono, minWidth: 56 }}>
        <div style={{ fontSize: T.sm, color: scoreColor, fontWeight: 600 }}>{r.score ?? "—"}</div>
        <div style={{ fontSize: T.xs, color: T.tf }}>score</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={onPin}
          title={pinned ? "Unpin" : "Pin to deploy"}
          style={{
            width: 22, height: 22, border: `1px solid ${pinned ? T.amber : T.bd}`,
            background: pinned ? T.amber + "22" : "transparent",
            color: pinned ? T.amber : T.tf,
            fontSize: T.sm, borderRadius: T.rSm, cursor: "pointer", lineHeight: 1, padding: 0,
          }}
        >⌖</button>
        <span style={{ fontSize: T.sm, color: hover ? T.cyan : T.tf, transition: "color 0.12s" }}>▸</span>
      </div>
    </div>
  );
}

// ── Upcoming Targets — positions within 40pp of close rule (FYI) ───────────────
export function UpcomingTargetsBlock({ positions, quoteMap }) {
  const rows = buildUpcomingRows(positions, quoteMap);
  if (rows.length === 0) return null;

  return (
    <Frame
      accent="quiet"
      title="UPCOMING TARGETS"
      subtitle={`${rows.length} position${rows.length > 1 ? "s" : ""} within 40pp of close rule · FYI`}
    >
      <div style={{ display: "grid", gap: 1, background: T.bd, border: `1px solid ${T.bd}`, borderRadius: T.rSm }}>
        {rows.slice(0, 4).map((p, i) => <UpcomingRow key={i} p={p} />)}
      </div>
    </Frame>
  );
}

function buildUpcomingRows(positions, quoteMap) {
  const rows = [];
  const addFrom = (list, type) => {
    (list || []).forEach(p => {
      if (!p.expiry_date || !p.strike || !p.contracts || !p.premium_collected) return;
      const dte = calcDTE(p.expiry_date);
      let dtePct = null;
      if (p.open_date && dte != null) {
        const total = Math.max(1, Math.round(
          (new Date(p.expiry_date + "T00:00:00") - new Date(p.open_date + "T00:00:00")) / 86400000
        ));
        dtePct = Math.round((dte / total) * 100);
      }
      const targetPct = targetProfitPctForDtePct(dtePct);
      if (targetPct == null) return;
      const sym = buildOccSymbol(p.ticker, p.expiry_date, type === "CC", p.strike);
      const mid = quoteMap?.get?.(sym)?.mid;
      if (mid == null) return;
      const glDollars = p.premium_collected - (mid * p.contracts * 100);
      const glPct     = Math.round((glDollars / p.premium_collected) * 100);
      const proximity = proximityFraction(glPct, targetPct);
      const ppToTarget = targetPct - glPct;
      if (proximity < 0.60 || glPct >= targetPct) return;
      rows.push({
        id: `${p.ticker}-${type}-${p.expiry_date}-${p.strike}`,
        ticker: p.ticker, type,
        strike: p.strike, dte: dte ?? 0,
        gl: Math.round(glDollars), glPct, targetPct, proximity, ppToTarget,
      });
    });
  };
  addFrom(positions?.open_csps, "CSP");
  const ccs = (positions?.assigned_shares || []).filter(s => s.active_cc).map(s => s.active_cc);
  addFrom(ccs, "CC");
  rows.sort((a, b) => b.proximity - a.proximity);
  return rows;
}

function UpcomingRow({ p }) {
  const [hover, setHover] = useState(false);
  const proximity = Math.max(0, Math.min(1, p.proximity));
  const color = proximity >= 0.9 ? T.green : proximity >= 0.75 ? T.amber : T.blueB;
  return (
    <div
      onClick={() => openPosition(p.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid", gridTemplateColumns: "52px 54px 1fr 88px", gap: 12, alignItems: "center",
        padding: "9px 12px",
        background: hover ? T.elev : T.surf, cursor: "pointer",
      }}
    >
      <span style={{ fontSize: T.md, fontWeight: 600, color: T.t1 }}>{p.ticker}</span>
      <span style={{
        fontSize: T.xs, padding: "2px 6px", border: `1px solid ${T.bd}`,
        color: T.tm, borderRadius: T.rSm, textAlign: "center", letterSpacing: "0.1em",
        fontFamily: T.mono,
      }}>{p.type}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: T.sm, color: T.tm, fontFamily: T.mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          ${p.strike} · {p.dte}d · {p.gl >= 0 ? "+" : "−"}${Math.abs(p.gl)}{" "}
          <span style={{ color: T.tf }}>({p.glPct >= 0 ? "+" : ""}{p.glPct}%)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <div style={{ flex: 1, height: 3, background: T.bd, borderRadius: 1, overflow: "hidden", minWidth: 40 }}>
            <div style={{ height: "100%", width: `${proximity * 100}%`, background: color }} />
          </div>
          <span style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono, whiteSpace: "nowrap" }}>
            {Math.max(0, p.ppToTarget)}pp to {p.targetPct}%
          </span>
        </div>
      </div>
      <span style={{ fontSize: T.xs, color, letterSpacing: "0.08em", textAlign: "right", whiteSpace: "nowrap", fontFamily: T.mono }}>
        {proximity >= 0.9 ? "CLOSE SOON" : proximity >= 0.75 ? "GETTING THERE" : "TRACKING"}
      </span>
    </div>
  );
}
