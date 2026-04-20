import { useState, useEffect } from "react";
import { T } from "../theme.js";
import { calcDTE, buildOccSymbol } from "../../lib/trading.js";
import { targetProfitPctForDtePct } from "../../lib/positionAttention.js";

// Module-level bridge — call openPosition(id) from any component
let _setId = null;
export function openPosition(id) { _setId?.(id); }

// ── Host — mount once in AppShell ─────────────────────────────────────────────
export function PositionDetailHost({ positions, trades, account, quoteMap }) {
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    _setId = setOpenId;
    return () => { _setId = null; };
  }, []);

  useEffect(() => {
    if (!openId) return;
    const fn = (e) => { if (e.key === "Escape") setOpenId(null); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [openId]);

  if (!openId) return null;

  const found = findRawPosition(openId, positions);
  if (!found) return null;
  const { raw, type, sharesRaw } = found;

  // Compute common fields
  const dte = calcDTE(raw.expiry_date) ?? 0;
  let dtePct = null;
  if (raw.open_date && raw.expiry_date) {
    const totalDays = Math.max(1, Math.round(
      (new Date(raw.expiry_date + "T00:00:00") - new Date(raw.open_date + "T00:00:00")) / 86400000
    ));
    dtePct = Math.round((dte / totalDays) * 100);
  }

  // G/L from quoteMap option mid price
  let glPct = null;
  let gl = null;
  let currentMid = null;
  if (raw.premium_collected && raw.strike && raw.expiry_date && raw.contracts && quoteMap) {
    try {
      const sym = buildOccSymbol(raw.ticker, raw.expiry_date, type === "CC", raw.strike);
      const q = quoteMap.get(sym);
      if (q?.mid != null) {
        currentMid = q.mid;
        const glDollars = raw.premium_collected - (q.mid * raw.contracts * 100);
        glPct = Math.round((glDollars / raw.premium_collected) * 100);
        gl = Math.round(glDollars);
      }
    } catch (_) {}
  }

  const targetPct = targetProfitPctForDtePct(dtePct);
  const pos = {
    id: openId, ticker: raw.ticker, type,
    strike: raw.strike, dte, dtePct, glPct, gl, targetPct,
    premiumCollected: raw.premium_collected,
    contracts: raw.contracts || 1,
    openDate: raw.open_date,
    expiryDate: raw.expiry_date,
    costBasis: sharesRaw?.cost_basis_total ?? raw.cost_basis_total ?? null,
  };

  const history = buildHistory(raw.ticker, trades);
  const scenarios = computeScenarios(pos, currentMid);
  const accountValue = account?.account_value ?? 0;
  const committed = type === "CSP"
    ? (pos.strike || 0) * pos.contracts * 100
    : (pos.costBasis || 0);

  return (
    <DrawerWrap
      pos={pos}
      history={history}
      scenarios={scenarios}
      accountValue={accountValue}
      committed={committed}
      currentMid={currentMid}
      onClose={() => setOpenId(null)}
    />
  );
}

// ── Position lookup ───────────────────────────────────────────────────────────
function findRawPosition(id, positions) {
  const match = (pos, type) => `${pos.ticker}-${type}-${pos.expiry_date}-${pos.strike}` === id;

  for (const pos of (positions?.open_csps || [])) {
    if (match(pos, "CSP")) return { raw: pos, type: "CSP" };
  }
  for (const share of (positions?.assigned_shares || [])) {
    // assigned_shares row itself (expiry/strike = undefined, yields "ticker-CC-undefined-undefined")
    if (match(share, "CC")) return { raw: share, type: "CC", sharesRaw: share };
    // CC option embedded in active_cc
    if (share.active_cc && match(share.active_cc, "CC")) {
      return { raw: share.active_cc, type: "CC", sharesRaw: share };
    }
    for (const leap of (share.open_leaps || [])) {
      if (match(leap, "LEAPS")) return { raw: leap, type: "LEAPS" };
    }
  }
  for (const pos of (positions?.open_leaps || [])) {
    if (match(pos, "LEAPS")) return { raw: pos, type: "LEAPS" };
  }
  for (const pos of (positions?.open_spreads || [])) {
    if (match(pos, "Spread")) return { raw: pos, type: "Spread" };
  }
  return null;
}

// ── History builder ───────────────────────────────────────────────────────────
function buildHistory(ticker, trades) {
  if (!trades?.length) return [];
  const kindMap = { CSP: "OPEN", CC: "OPEN", LEAPS: "OPEN" };
  const subtypeKind = { Close: "CLOSE", "Roll Loss": "ROLL", Assigned: "ASSIGN", Sold: "CLOSE", Exit: "CLOSE" };

  return (trades || [])
    .filter(t => t.ticker === ticker)
    .slice(0, 12)
    .map(t => ({
      date: t.close || t.open || "—",
      kind: subtypeKind[t.subtype] || (t.subtype ? "ROLL" : kindMap[t.type] || "OPEN"),
      note: `${t.type}${t.strike ? ` $${t.strike}` : ""} · ${
        t.premium != null ? (t.premium >= 0 ? `+$${t.premium}` : `-$${Math.abs(t.premium)}`) : "—"
      }${t.contracts ? ` · ${t.contracts}ct` : ""}`,
    }));
}

// ── Scenario builder ──────────────────────────────────────────────────────────
function computeScenarios(pos, currentMid) {
  const premium = pos.premiumCollected ?? 0;
  const dte = pos.dte ?? 0;
  const ct = pos.contracts ?? 1;

  // RIDE: expire worthless → keep full premium
  const rideRealized = premium;

  // CLOSE NOW: cost to close × contracts × 100
  const closeRealized = currentMid != null
    ? premium - (currentMid * ct * 100)
    : null;

  return [
    {
      label: "RIDE TO EXPIRY",
      note: "expire worthless, keep full premium",
      realized: rideRealized,
      dteRemaining: dte,
    },
    ...(closeRealized != null ? [{
      label: "CLOSE NOW",
      note: `buy back @ $${currentMid.toFixed(2)} mid`,
      realized: Math.round(closeRealized),
      dteRemaining: 0,
    }] : []),
    {
      label: "ROLL",
      note: "check options chain for credit",
      realized: 0,
      dteRemaining: dte,
    },
  ];
}

// ── Drawer shell ──────────────────────────────────────────────────────────────
function DrawerWrap({ pos, history, scenarios, accountValue, committed, currentMid, onClose }) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.45)", zIndex: 90,
          animation: "pdFadeIn 140ms ease",
        }}
      />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 540,
        background: T.bg, borderLeft: `1px solid ${T.bd}`,
        boxShadow: "-8px 0 32px rgba(0,0,0,0.5)",
        zIndex: 100, overflowY: "auto",
        animation: "pdSlideIn 180ms cubic-bezier(.4,0,.2,1)",
      }}>
        <DetailBody
          pos={pos} history={history} scenarios={scenarios}
          accountValue={accountValue} committed={committed}
          currentMid={currentMid} onClose={onClose}
        />
      </div>
      <style>{`
        @keyframes pdSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes pdFadeIn  { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </>
  );
}

// ── Body ──────────────────────────────────────────────────────────────────────
function DetailBody({ pos, history, scenarios, accountValue, committed, currentMid, onClose }) {
  return (
    <div style={{ paddingBottom: 48 }}>
      <DHeader pos={pos} onClose={onClose} />
      <div style={{ padding: "14px 20px" }}>
        <CurrentState pos={pos} currentMid={currentMid} />
        {pos.type === "CC" && <UnderlyingShares pos={pos} currentMid={currentMid} />}
        <Scenarios scenarios={scenarios} />
        <ConcentrationSection pos={pos} accountValue={accountValue} committed={committed} />
        <HistorySection history={history} ticker={pos.ticker} />
        <JournalSection ticker={pos.ticker} />
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────
function DHeader({ pos, onClose }) {
  const [reviewed, setReviewed] = useState(false);
  const [pinned,   setPinned]   = useState(false);
  const [reminded, setReminded] = useState(false);

  return (
    <div style={{
      padding: "14px 20px 12px", borderBottom: `1px solid ${T.bd}`,
      position: "sticky", top: 0, background: T.bg + "fc", backdropFilter: "blur(6px)", zIndex: 2,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontSize: T.xs, color: T.tf, letterSpacing: "0.12em", marginBottom: 5 }}>
            {pos.type} · POSITION DETAIL
          </div>
          <div style={{ fontSize: 22, fontFamily: T.mono, color: T.t1, fontWeight: 600, letterSpacing: "0.02em" }}>
            {pos.ticker}
            {pos.strike && (
              <span style={{ fontSize: 13, color: T.ts, marginLeft: 10 }}>
                ${pos.strike} {pos.type} · {pos.dte}d
              </span>
            )}
          </div>
          {pos.openDate && (
            <div style={{ fontSize: T.xs, color: T.tf, marginTop: 4, letterSpacing: "0.08em" }}>
              opened {pos.openDate}
              {pos.expiryDate && <span style={{ marginLeft: 8 }}>→ exp {pos.expiryDate}</span>}
            </div>
          )}
        </div>
        <button onClick={onClose} style={{
          background: "none", border: `1px solid ${T.bd}`, color: T.ts,
          padding: "4px 10px", fontFamily: T.mono, fontSize: 11, cursor: "pointer",
          letterSpacing: "0.08em", flexShrink: 0,
        }}>ESC</button>
      </div>

      <div style={{ display: "flex", gap: 5, marginTop: 12 }}>
        <DAction active={reviewed} onClick={() => setReviewed(v => !v)}
          label={reviewed ? "✓ REVIEWED" : "MARK REVIEWED"} />
        <DAction active={pinned} onClick={() => setPinned(v => !v)}
          label={pinned ? "✓ PINNED" : "PIN TO RADAR"} />
        <DAction active={reminded} onClick={() => setReminded(v => !v)}
          label={reminded ? "✓ 1h" : "REMIND IN 1h"} />
      </div>
    </div>
  );
}

function DAction({ active, onClick, label }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, background: active ? T.elev : "none",
      border: `1px solid ${active ? T.bdS : T.bd}`,
      color: active ? T.t1 : T.ts,
      padding: "7px 6px", fontFamily: T.mono, fontSize: 10,
      letterSpacing: "0.08em", cursor: "pointer",
      transition: "all 120ms",
    }}>{label}</button>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────
function DSection({ label, right, children }) {
  return (
    <div style={{ marginTop: 22, marginBottom: 22 }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        borderBottom: `1px solid ${T.bd}`, paddingBottom: 4, marginBottom: 10,
      }}>
        <div style={{ fontSize: T.xs, color: T.tf, letterSpacing: "0.14em" }}>[ {label} ]</div>
        {right && <div style={{ fontSize: T.xs, color: T.tf }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}

function DDatum({ k, v, sub, tone }) {
  const col = tone === "green" ? T.green : tone === "red" ? T.red : tone === "amb" ? T.amber : T.t1;
  return (
    <div>
      <div style={{ fontSize: T.xs, color: T.tf, letterSpacing: "0.1em", marginBottom: 3 }}>{k}</div>
      <div style={{ fontSize: 18, color: col, fontFamily: T.mono, fontWeight: 500 }}>{v}</div>
      {sub && <div style={{ fontSize: T.xs, color: T.tf, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function CurrentState({ pos, currentMid }) {
  const isCC = pos.type === "CC";
  const hasOption = pos.strike && pos.expiryDate;

  return (
    <DSection label="CURRENT STATE" right={pos.openDate ? `opened ${pos.openDate}` : undefined}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
        <DDatum k="STRIKE" v={pos.strike ? `$${pos.strike}` : "—"} sub={`${pos.contracts}ct`} />
        <DDatum
          k="DTE / ELAPSED"
          v={hasOption ? `${pos.dte}d` : "—"}
          sub={pos.dtePct != null ? `${pos.dtePct}% left` : undefined}
        />
        <DDatum
          k="G/L"
          v={pos.gl != null ? `${pos.gl >= 0 ? "+" : "-"}$${Math.abs(pos.gl).toLocaleString()}` : "—"}
          sub={pos.glPct != null ? `${pos.glPct >= 0 ? "+" : ""}${pos.glPct}% of premium` : "live quote needed"}
          tone={pos.gl == null ? undefined : pos.gl >= 0 ? "green" : "red"}
        />
        <DDatum
          k="PREMIUM"
          v={pos.premiumCollected != null ? `$${pos.premiumCollected.toLocaleString()}` : "—"}
          sub="collected at open"
        />
      </div>

      {pos.targetPct != null && pos.glPct != null && (
        <div style={{ marginTop: 14 }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
            fontSize: T.xs, color: T.tf, marginBottom: 5, letterSpacing: "0.08em",
          }}>
            <span>CLOSE RULE · {pos.targetPct}% target</span>
            <span style={{ color: pos.glPct >= pos.targetPct ? T.green : T.ts }}>
              {pos.glPct}% / {pos.targetPct}%
            </span>
          </div>
          <div style={{ height: 5, background: T.bd, position: "relative", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              position: "absolute", top: 0, left: 0, bottom: 0,
              width: `${Math.max(0, Math.min(100, (pos.glPct / pos.targetPct) * 100))}%`,
              background: pos.glPct >= pos.targetPct ? T.green : pos.glPct < 0 ? T.red : T.amber,
              transition: "width 0.3s",
            }} />
          </div>
        </div>
      )}
    </DSection>
  );
}

function UnderlyingShares({ pos, currentMid }) {
  const basis = pos.costBasis;
  if (!basis) return null;
  const contracts = pos.contracts ?? 1;
  const shares = contracts * 100;
  const basisPerShare = basis / shares;
  const strikeVsBasis = pos.strike ? pos.strike - basisPerShare : null;
  const sharesPl = currentMid != null && basisPerShare ? (currentMid - basisPerShare) * shares : null;

  return (
    <DSection label="UNDERLYING SHARES">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        <DDatum k="SHARES (EST)" v={`${shares.toLocaleString()}`} sub={`$${basis.toLocaleString()} total basis`} />
        <DDatum
          k="PER-SHARE BASIS"
          v={`$${basisPerShare.toFixed(2)}`}
          sub={currentMid != null ? `mid price $${currentMid.toFixed(2)}` : "live quote needed"}
        />
        {strikeVsBasis != null && (
          <DDatum
            k="CC STRIKE vs BASIS"
            v={strikeVsBasis >= 0 ? `+$${strikeVsBasis.toFixed(2)}` : `-$${Math.abs(strikeVsBasis).toFixed(2)}`}
            sub={strikeVsBasis >= 0 ? "above basis · safe if called" : "below basis · loss if called"}
            tone={strikeVsBasis >= 0 ? "green" : "red"}
          />
        )}
      </div>
      {strikeVsBasis != null && (
        <div style={{
          marginTop: 10, padding: "8px 12px",
          background: T.elev, border: `1px solid ${T.bd}`,
          fontSize: T.sm, color: T.ts, fontFamily: T.mono, lineHeight: 1.55,
        }}>
          {strikeVsBasis >= 0
            ? `If assigned away: realize +$${(strikeVsBasis * shares).toFixed(0)} on shares plus premium kept.`
            : `If assigned away: realize -$${Math.abs(strikeVsBasis * shares).toFixed(0)} on shares. Consider rolling up.`}
          {sharesPl != null && (
            <span style={{ color: sharesPl >= 0 ? T.green : T.red, marginLeft: 8 }}>
              · open share P/L {sharesPl >= 0 ? "+" : "-"}${Math.abs(sharesPl).toFixed(0)}
            </span>
          )}
        </div>
      )}
    </DSection>
  );
}

function Scenarios({ scenarios }) {
  const [ride, ...rest] = scenarios;
  const ordered = ride ? [ride, ...rest] : scenarios;

  return (
    <DSection label="SCENARIOS" right="ride · close · roll">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {ordered.map((s, i) => {
          const isRide = i === 0 && s.label.startsWith("RIDE");
          const realizedColor = s.realized === 0 ? T.ts : s.realized > 0 ? T.green : T.red;
          return (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "120px 1fr 100px 60px",
              gap: 12, alignItems: "center",
              padding: "10px 12px",
              border: `1px solid ${isRide ? T.bdS : T.bd}`,
              background: isRide ? T.elev + "60" : "transparent",
            }}>
              <div style={{ fontSize: T.sm, color: T.t1, fontFamily: T.mono, letterSpacing: "0.06em" }}>
                {s.label}
              </div>
              <div style={{ fontSize: T.sm, color: T.ts, fontFamily: T.mono, minWidth: 0 }}>
                {s.note}
              </div>
              <div style={{ fontSize: 13, fontFamily: T.mono, textAlign: "right", color: realizedColor }}>
                {s.realized === 0 ? "—" : `${s.realized >= 0 ? "+" : "-"}$${Math.abs(s.realized).toLocaleString()}`}
              </div>
              <div style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono, textAlign: "right" }}>
                {s.dteRemaining > 0 ? `${s.dteRemaining}d` : "now"}
              </div>
            </div>
          );
        })}
      </div>
    </DSection>
  );
}

function ConcentrationSection({ pos, accountValue, committed }) {
  if (!accountValue) return null;
  const pct = (committed / accountValue) * 100;
  const pctLabel = `${pct.toFixed(1)}%`;
  const overPos = pct > 10;

  return (
    <DSection label="CONCENTRATION">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <DDatum
          k="THIS POSITION"
          v={pctLabel}
          sub={`$${committed.toLocaleString()} · target ≤10%`}
          tone={overPos ? "amb" : "green"}
        />
        <DDatum
          k="ACCOUNT VALUE"
          v={`$${accountValue.toLocaleString()}`}
          sub="total"
        />
      </div>
      {overPos && (
        <div style={{
          marginTop: 10, padding: "7px 12px",
          background: T.amber + "12", border: `1px solid ${T.amber}44`,
          fontSize: T.sm, color: T.amber, fontFamily: T.mono,
        }}>
          ▲ Over 10% concentration. Consider sizing down on next roll.
        </div>
      )}
    </DSection>
  );
}

function HistorySection({ history, ticker }) {
  const kindColor = { OPEN: T.green, CLOSE: T.amber, ROLL: T.mag, ASSIGN: T.red };

  return (
    <DSection label={`TICKER HISTORY · ${ticker}`} right={history.length ? `${history.length} events` : undefined}>
      {history.length === 0 ? (
        <div style={{ fontSize: T.sm, color: T.tf, fontFamily: T.mono, padding: "8px 0" }}>
          No closed trades for {ticker}.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {history.map((h, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "64px 64px 1fr",
              gap: 10, fontSize: T.sm, color: T.ts, fontFamily: T.mono,
              padding: "6px 2px",
              borderBottom: i < history.length - 1 ? `1px dashed ${T.hair}` : "none",
            }}>
              <span style={{ fontSize: T.xs, color: T.tf }}>{h.date}</span>
              <span style={{ fontSize: T.xs, color: kindColor[h.kind] || T.ts, letterSpacing: "0.06em" }}>
                {h.kind}
              </span>
              <span style={{ color: T.ts, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {h.note}
              </span>
            </div>
          ))}
        </div>
      )}
    </DSection>
  );
}

function JournalSection({ ticker }) {
  return (
    <DSection label={`JOURNAL · ${ticker}`}>
      <div style={{ fontSize: T.sm, color: T.tf, fontFamily: T.mono, padding: "8px 0" }}>
        No entries tagged for {ticker}. Add one from the Journal surface.
      </div>
    </DSection>
  );
}
