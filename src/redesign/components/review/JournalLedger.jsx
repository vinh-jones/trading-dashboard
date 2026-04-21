import { useState } from "react";
import { T } from "../../theme.js";
import { openPosition } from "../PositionDetail.jsx";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseMmDd(mmdd) {
  if (!mmdd || mmdd === "—") return 0;
  const [m, d] = mmdd.split("/").map(Number);
  return (m * 100) + d;
}

function dateLabel(mmdd) {
  if (!mmdd || mmdd === "—") return "—";
  const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [m, d] = mmdd.split("/").map(Number);
  return `${MONTHS[m] || m} ${d}`;
}

function todayMmDd() {
  return new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" });
}

function timeOfIso(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false }) + " ET";
}

// ── Row types ─────────────────────────────────────────────────────────────────

const TYPE_BADGE = {
  eod_update:    { label: "EOD UPDATE",    color: T.mag },
  trade_note:    { label: "TRADE NOTE",    color: T.blue },
  position_note: { label: "POSITION NOTE", color: T.cyan },
  roll:          { label: "ROLL",          color: T.cyan },
};

const MOOD_COLOR = {
  focused: T.blue, confident: T.green, neutral: T.tm,
  cautious: T.amber, rattled: T.red, steady: T.green, anxious: T.red,
};

function Dot() {
  return <span style={{ color: T.tf }}>·</span>;
}

function TagChip({ t, small }) {
  const isTicker = /^[A-Z]{2,5}$/.test(t);
  return (
    <span style={{
      padding: small ? "1px 6px" : "2px 8px",
      border: `1px solid ${T.bdS || T.bd}`,
      color: isTicker ? T.blue : T.tm,
      fontSize: small ? 9 : 10, fontFamily: T.mono, letterSpacing: "0.03em",
      cursor: "default",
    }}>{t}</span>
  );
}

function EodEntry({ e, account, todayTrades, onOpen }) {
  const mood = (e.mood || "").toLowerCase();
  const moodColor = MOOD_COLOR[mood] || T.tm;
  const body = e.body || e.title || "";
  const summary = body.split(/[.\n]/)[0] || body;
  const truncated = summary.length < body.length - 1;

  const vix = e.metadata?.vix ?? account?.vix_current ?? null;
  const cashPct = e.metadata?.cashPct ?? account?.free_cash_pct_est ?? null;
  const mtd = e.metadata?.mtd ?? account?.month_to_date_premium ?? null;
  const closes = e.metadata?.closes ?? todayTrades?.length ?? null;
  const inBand = e.metadata?.inBand ?? null;

  return (
    <div
      onClick={onOpen}
      style={{
        border: `1px solid ${T.bd}`,
        borderLeft: `3px solid ${T.mag}`,
        background: T.surf,
        padding: "14px 16px",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{
          fontSize: T.xs, letterSpacing: "0.1em", color: T.mag,
          fontFamily: T.mono, fontWeight: 600,
          padding: "2px 8px", border: `1px solid ${T.mag}55`, background: T.mag + "10",
        }}>EOD UPDATE</span>
        <span style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono }}>{timeOfIso(e.created_at)}</span>
        {mood && (
          <span style={{
            fontSize: T.xs, letterSpacing: "0.08em", color: moodColor,
            fontFamily: T.mono,
            padding: "2px 8px", border: `1px solid ${moodColor}40`,
          }}>{mood.toUpperCase()}</span>
        )}
        {vix != null && (
          <span style={{ fontSize: T.xs, color: T.tm, fontFamily: T.mono, marginLeft: 4 }}>
            VIX <span style={{ color: T.t2 }}>{typeof vix === "number" ? vix.toFixed(2) : vix}</span>
          </span>
        )}
        {cashPct != null && (
          <span style={{ fontSize: T.xs, color: T.tm, fontFamily: T.mono }}>
            Cash <span style={{ color: T.t2 }}>{typeof cashPct === "number" ? (cashPct * 100).toFixed(1) + "%" : cashPct}</span>
          </span>
        )}
        {inBand === true && (
          <span style={{ fontSize: T.xs, color: T.green, fontFamily: T.mono, letterSpacing: "0.05em" }}>✓ in band</span>
        )}
        {inBand === false && (
          <span style={{ fontSize: T.xs, color: T.amber, fontFamily: T.mono, letterSpacing: "0.05em" }}>⚠ out of band</span>
        )}
        {mtd != null && (
          <span style={{ fontSize: T.xs, color: T.tm, fontFamily: T.mono }}>
            MTD <span style={{ color: T.t2 }}>${typeof mtd === "number" ? mtd.toLocaleString() : mtd}</span>
          </span>
        )}
        {closes != null && closes > 0 && (
          <span style={{ fontSize: T.xs, color: T.tm, fontFamily: T.mono }}>{closes} closes</span>
        )}
        <span style={{ marginLeft: "auto", fontSize: T.xs, color: T.tf, fontFamily: T.mono }}>expand ↗</span>
      </div>
      <div style={{ fontSize: T.sm, color: T.t1, lineHeight: 1.6, fontFamily: T.mono }}>
        {summary}{truncated ? "…" : ""}
      </div>
      {e.tags?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {e.tags.map(t => <TagChip key={t} t={t} />)}
        </div>
      )}
    </div>
  );
}

function TxnEntry({ e, trades, account, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody]       = useState(e.body || "");
  const [saving, setSaving]   = useState(false);

  // Look up the underlying trade. First by explicit trade_id, then fall back to
  // ticker+date matching (entries predating the trade_id linking or manually
  // written TRADE notes often have ticker but no trade_id).
  const tradeId = e.trade_id ?? e.metadata?.trade_id ?? null;
  let trade = tradeId != null
    ? (trades || []).find(t => String(t.id) === String(tradeId))
    : null;

  const entryTicker = e.ticker || (e.tags || []).find(t => /^[A-Z]{2,5}$/.test(t));
  if (!trade && entryTicker && e.entry_date) {
    const entryMs = new Date(e.entry_date).getTime();
    // Find the trade for this ticker whose close or open is nearest (within 5 days) to the entry date
    const WINDOW_MS = 5 * 86400000;
    const candidates = (trades || [])
      .filter(t => t.ticker === entryTicker)
      .map(t => {
        const closeMs = t.close_date ? new Date(t.close_date).getTime() : null;
        const openMs  = t.open_date  ? new Date(t.open_date).getTime()  : null;
        const best = [closeMs, openMs]
          .filter(x => x != null)
          .map(x => Math.abs(x - entryMs))
          .reduce((a, b) => Math.min(a, b), Infinity);
        return { t, distance: best };
      })
      .filter(x => x.distance < WINDOW_MS)
      .sort((a, b) => a.distance - b.distance);
    if (candidates.length > 0) trade = candidates[0].t;
  }

  const ticker = trade?.ticker || entryTicker;
  const badge = TYPE_BADGE[e.entry_type] || TYPE_BADGE.trade_note;

  // Action verb (Opened / Closed / Rolled / Assigned)
  let action = null;
  if (trade) {
    const sub = (trade.subtype || "").toLowerCase();
    if (sub.includes("roll"))        action = "Rolled";
    else if (sub === "assigned")     action = "Assigned";
    else if (trade.close_date && trade.close_date !== trade.open_date) action = "Closed";
    else if (trade.open_date)        action = "Opened";
  }

  const putCallSuffix = trade?.type === "CSP" ? "p"
    : (trade?.type === "CC" || trade?.type === "LEAPS") ? "c"
    : "";

  const expiryMmDd = trade?.expiry_date ? trade.expiry_date.slice(5).replace("-", "/") : null;

  // Entry / exit cost (per-share mid, negative on exit means loss realized)
  const entryCost = trade?.entry_cost ?? null;
  const exitCost  = trade?.exit_cost  ?? null;

  // Cash % — capital_fronted ÷ account value (rough exposure)
  const accountValue = account?.account_value ?? null;
  const cashPct = (trade?.fronted != null && accountValue)
    ? (trade.fronted / accountValue) * 100
    : null;

  // DTE display: for closed/rolled/assigned trades show days_held; else days-to-expiry at open
  let dteDisplay = null;
  if (trade) {
    if (action === "Closed" || action === "Rolled" || action === "Assigned") {
      if (trade.days != null) dteDisplay = `${trade.days}d hold`;
    } else if (trade.expiry_date && trade.open_date) {
      const dte = Math.ceil((new Date(trade.expiry_date) - new Date(trade.open_date)) / 86400000);
      if (dte > 0) dteDisplay = `${dte}d`;
    }
  }

  const pl = trade?.premium ?? null;

  // If we couldn't find a trade but we have a ticker, still render a minimal header
  const showTickerOnly = !trade && ticker;

  const save = async () => {
    const text = body.trim();
    if (!text || !onUpdate) return;
    setSaving(true);
    const ok = await onUpdate(e.id, text);
    setSaving(false);
    if (ok) setEditing(false);
  };

  const del = async () => {
    if (!onDelete) return;
    if (!window.confirm("Delete this reflection?")) return;
    await onDelete(e.id);
  };

  return (
    <div style={{
      border: `1px solid ${T.bd}`,
      background: T.surf,
      padding: "10px 14px",
    }}>
      {/* Top row: badge + time + edit */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{
          fontSize: T.xs, letterSpacing: "0.1em", color: badge.color,
          fontFamily: T.mono, fontWeight: 600,
          padding: "2px 6px", border: `1px solid ${badge.color}55`, background: badge.color + "10",
          whiteSpace: "nowrap",
        }}>{badge.label}</span>
        <span style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono, whiteSpace: "nowrap" }}>
          {timeOfIso(e.created_at)}
        </span>
        <span style={{ flex: 1 }} />
        {!editing && (e.tags || []).filter(t => t !== ticker).slice(0, 2).map(t => <TagChip key={t} t={t} small />)}
        {!editing && onUpdate && (
          <button
            onClick={() => setEditing(true)}
            title="Edit reflection"
            style={{
              border: `1px solid ${T.bd}`, background: "transparent", color: T.tm,
              padding: "2px 8px", fontSize: T.xs, fontFamily: T.mono,
              letterSpacing: "0.05em", cursor: "pointer",
            }}
          >EDIT</button>
        )}
      </div>

      {/* Title line: ◆ {ticker} : {type} ${strike} — {action} */}
      {trade ? (
        <div style={{
          marginTop: 8, fontFamily: T.mono, fontSize: T.md,
          color: T.t1, display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap",
        }}>
          <span style={{ color: T.tf, fontSize: T.sm }}>◆</span>
          <span style={{ fontWeight: 600 }}>{trade.ticker}</span>
          <span style={{ color: T.tf }}>:</span>
          <span style={{ color: T.t2 }}>{trade.type}</span>
          {trade.strike != null && <span style={{ color: T.t2 }}>${trade.strike}</span>}
          {action && (
            <>
              <span style={{ color: T.tf }}>—</span>
              <span style={{ color: T.t2 }}>{action}</span>
            </>
          )}
        </div>
      ) : showTickerOnly ? (
        <div style={{
          marginTop: 8, fontFamily: T.mono, fontSize: T.md,
          color: T.t1, display: "flex", alignItems: "baseline", gap: 6,
        }}>
          <span style={{ color: T.tf, fontSize: T.sm }}>◆</span>
          <span style={{ fontWeight: 600 }}>{ticker}</span>
          {e.title && (
            <>
              <span style={{ color: T.tf }}>—</span>
              <span style={{ color: T.t2 }}>{e.title}</span>
            </>
          )}
        </div>
      ) : null}

      {/* Metadata line */}
      {trade && (
        <div style={{
          marginTop: 4, fontSize: T.xs, color: T.tm, fontFamily: T.mono,
          display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline",
        }}>
          {trade.strike != null && (
            <span>${trade.strike}{putCallSuffix}</span>
          )}
          {expiryMmDd && <><Dot /><span>exp {expiryMmDd}</span></>}
          {trade.contracts != null && <><Dot /><span>{trade.contracts} ct</span></>}
          {entryCost != null && (
            <>
              <Dot />
              <span>
                @ ${Math.abs(entryCost).toFixed(2)}
                {exitCost != null && (
                  <span style={{ color: T.tf }}> → ${Math.abs(exitCost).toFixed(2)}</span>
                )}
              </span>
            </>
          )}
          {cashPct != null && <><Dot /><span>{cashPct.toFixed(1)}% cash</span></>}
          {pl != null && action !== "Opened" && (
            <>
              <Dot />
              <span style={{ color: pl >= 0 ? T.green : T.red, fontWeight: 600 }}>
                {pl >= 0 ? "+" : "−"}${Math.abs(pl).toLocaleString()}
              </span>
            </>
          )}
          {trade.roi != null && (
            <>
              <Dot />
              <span style={{ color: trade.roi >= 0 ? T.green : T.red }}>
                {trade.roi >= 0 ? "+" : ""}{trade.roi.toFixed(2)}% RoR
              </span>
            </>
          )}
          {dteDisplay && <><Dot /><span>{dteDisplay}</span></>}
        </div>
      )}

      {/* Body / reflection */}
      {editing ? (
        <div style={{ marginTop: 10 }}>
          <textarea
            value={body}
            onChange={evt => setBody(evt.target.value)}
            autoFocus
            style={{
              width: "100%", minHeight: 70,
              padding: 10, background: T.bg, border: `1px solid ${T.bd}`,
              color: T.t2, fontSize: T.sm, fontFamily: T.mono, lineHeight: 1.5,
              resize: "vertical", outline: "none", borderRadius: 2,
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <button
              onClick={del}
              style={{
                border: `1px solid ${T.bd}`, background: "transparent", color: T.red,
                padding: "4px 12px", fontSize: T.xs, fontFamily: T.mono,
                letterSpacing: "0.05em", cursor: "pointer",
              }}
            >Delete</button>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => { setEditing(false); setBody(e.body || ""); }}
                style={{
                  border: `1px solid ${T.bd}`, background: "transparent", color: T.tm,
                  padding: "4px 12px", fontSize: T.xs, fontFamily: T.mono,
                  letterSpacing: "0.05em", cursor: "pointer",
                }}
              >Cancel</button>
              <button
                onClick={save}
                disabled={!body.trim() || saving}
                style={{
                  border: `1px solid ${T.blue}`,
                  background: body.trim() && !saving ? T.blue + "22" : "transparent",
                  color: body.trim() && !saving ? T.blue : T.tf,
                  padding: "4px 12px", fontSize: T.xs, fontFamily: T.mono,
                  letterSpacing: "0.05em", cursor: body.trim() && !saving ? "pointer" : "default",
                  fontWeight: 600,
                }}
              >{saving ? "SAVING…" : "SAVE"}</button>
            </div>
          </div>
        </div>
      ) : (
        e.body && (
          <div style={{
            fontSize: T.sm, color: T.t2, lineHeight: 1.55, fontFamily: T.mono,
            marginTop: (trade || showTickerOnly) ? 8 : 4,
            whiteSpace: "pre-wrap",
          }}>
            {e.body}
          </div>
        )
      )}
    </div>
  );
}

function TxnStubEntry({ trade, onSave, saving }) {
  const [writing, setWriting] = useState(false);
  const [body, setBody] = useState("");

  const typeColor = ({ CSP: T.blue, CC: T.green, LEAPS: "#a476f7", Spread: T.amber })[trade.type] || T.tm;
  const pl = trade.premium ?? 0;

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    await onSave(trade, text);
    setWriting(false);
    setBody("");
  };

  return (
    <div style={{
      border: `1px dashed ${T.bd}`,
      background: T.surf + "80",
      padding: "10px 14px",
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "auto auto 1fr auto", gap: 14, alignItems: "center" }}>
        <span style={{
          fontSize: T.xs, letterSpacing: "0.1em", color: typeColor,
          fontFamily: T.mono, fontWeight: 600,
          padding: "2px 6px", border: `1px solid ${typeColor}55`, background: typeColor + "10",
          whiteSpace: "nowrap",
        }}>{trade.type}</span>
        <span style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono, whiteSpace: "nowrap" }}>
          {trade.close && trade.close !== "—" ? `${trade.close} close` : "—"}
        </span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, fontFamily: T.mono, flexWrap: "wrap" }}>
          <span style={{ color: T.t1, fontSize: T.sm, fontWeight: 600 }}>{trade.ticker}</span>
          {trade.strike != null && <span style={{ color: T.tm, fontSize: T.xs }}>${trade.strike}</span>}
          {trade.contracts != null && <span style={{ color: T.tm, fontSize: T.xs }}>· {trade.contracts} ct</span>}
          {trade.days != null && <span style={{ color: T.tm, fontSize: T.xs }}>· {trade.days}d hold</span>}
          <span style={{ color: pl >= 0 ? T.green : T.red, fontSize: T.sm, fontWeight: 600 }}>
            {pl >= 0 ? "+" : "−"}${Math.abs(pl).toLocaleString()}
          </span>
          {!writing && (
            <span style={{ color: T.amber, fontSize: T.xs, fontStyle: "italic", opacity: 0.8, marginLeft: 8 }}>
              › add reflection
            </span>
          )}
        </div>
        {!writing && (
          <button
            onClick={() => setWriting(true)}
            style={{
              border: `1px solid ${T.bd}`, background: "transparent", color: T.t2,
              padding: "4px 10px", fontSize: T.xs, fontFamily: T.mono,
              letterSpacing: "0.05em", cursor: "pointer",
            }}
          >WRITE</button>
        )}
      </div>

      {writing && (
        <div style={{ marginTop: 10 }}>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            autoFocus
            placeholder="What's the reflection? (why you closed, what you learned, what to repeat/avoid)"
            style={{
              width: "100%", minHeight: 70,
              padding: 10, background: T.bg, border: `1px solid ${T.bd}`,
              color: T.t2, fontSize: T.sm, fontFamily: T.mono, lineHeight: 1.5,
              resize: "vertical", outline: "none", borderRadius: 2,
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button
              onClick={() => { setWriting(false); setBody(""); }}
              style={{
                border: `1px solid ${T.bd}`, background: "transparent", color: T.tm,
                padding: "4px 12px", fontSize: T.xs, fontFamily: T.mono,
                letterSpacing: "0.05em", cursor: "pointer",
              }}
            >Cancel</button>
            <button
              onClick={submit}
              disabled={!body.trim() || saving}
              style={{
                border: `1px solid ${T.blue}`,
                background: body.trim() && !saving ? T.blue + "22" : "transparent",
                color: body.trim() && !saving ? T.blue : T.tf,
                padding: "4px 12px", fontSize: T.xs, fontFamily: T.mono,
                letterSpacing: "0.05em", cursor: body.trim() && !saving ? "pointer" : "default",
                fontWeight: 600,
              }}
            >{saving ? "SAVING…" : "SAVE"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Ledger composition ────────────────────────────────────────────────────────
// Merge journal_entries + auto-stubs from closed trades without reflections.
export function buildLedgerItems(entries, trades) {
  const byTradeId = new Set();
  (entries || []).forEach(e => {
    const id = e.trade_id ?? e.metadata?.trade_id;
    if (id != null) byTradeId.add(String(id));
  });

  const stubs = (trades || [])
    .filter(t => t.close && t.close !== "—" && t.id != null)
    .filter(t => !byTradeId.has(String(t.id)))
    .slice(-30) // recent 30 trades
    .map(t => ({
      kind: "stub",
      id: `stub-${t.id}`,
      date: t.close,
      sortDate: t.closeDate || new Date(),
      trade: t,
    }));

  const real = (entries || []).map(e => {
    const when = e.entry_date || e.created_at;
    const dateObj = when ? new Date(when) : new Date(0);
    return {
      kind: e.entry_type === "eod_update" ? "eod" : "txn",
      id: e.id,
      date: when
        ? dateObj.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" })
        : "—",
      sortDate: dateObj,
      entry: e,
    };
  });

  return [...real, ...stubs].sort((a, b) => b.sortDate - a.sortDate);
}

export function JournalLedger({ items, account, trades, onOpenEod, onSaveStub, onUpdateTxn, onDeleteTxn, savingTradeId }) {
  // Group by date string (MM/DD)
  const groups = {};
  items.forEach(it => {
    const k = it.date;
    if (!groups[k]) groups[k] = [];
    groups[k].push(it);
  });
  const orderedDates = Object.keys(groups).sort((a, b) => parseMmDd(b) - parseMmDd(a));

  if (items.length === 0) {
    return (
      <div style={{
        border: `1px solid ${T.bd}`, borderLeft: `3px solid ${T.mag}`,
        background: T.surf, padding: "28px 20px",
        textAlign: "center", fontFamily: T.mono,
      }}>
        <div style={{ fontSize: 24, color: T.mag, marginBottom: 10 }}>◆</div>
        <div style={{ fontSize: T.md, color: T.t1, marginBottom: 6 }}>Start your daily ritual.</div>
        <div style={{ fontSize: T.sm, color: T.ts, lineHeight: 1.6, maxWidth: 460, margin: "0 auto" }}>
          Your first EOD entry appears here after market close. Transaction notes auto-stub when you close positions — just add the reflection.
        </div>
      </div>
    );
  }

  const today = todayMmDd();
  const todayTrades = (trades || []).filter(t => t.close === today || t.open === today);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {orderedDates.map(d => (
        <div key={d}>
          <div style={{
            display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10,
            paddingBottom: 6, borderBottom: `1px solid ${T.bd}`,
          }}>
            <span style={{ fontSize: T.xs, color: T.t1, fontFamily: T.mono, letterSpacing: "0.1em", fontWeight: 600 }}>
              {dateLabel(d).toUpperCase()}
            </span>
            <span style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono }}>
              {groups[d].length} entries
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {groups[d].map(it => {
              if (it.kind === "eod") {
                return (
                  <EodEntry
                    key={it.id} e={it.entry}
                    account={account}
                    todayTrades={it.date === today ? todayTrades : null}
                    onOpen={() => onOpenEod(it.entry)}
                  />
                );
              }
              if (it.kind === "stub") {
                return (
                  <TxnStubEntry
                    key={it.id} trade={it.trade}
                    onSave={onSaveStub}
                    saving={savingTradeId === it.trade.id}
                  />
                );
              }
              return (
                <TxnEntry
                  key={it.id} e={it.entry}
                  trades={trades}
                  account={account}
                  onUpdate={onUpdateTxn}
                  onDelete={onDeleteTxn}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
