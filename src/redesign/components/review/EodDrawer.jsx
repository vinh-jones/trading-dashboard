import { useEffect, useState, useMemo } from "react";
import { T } from "../../theme.js";
import { openPosition } from "../PositionDetail.jsx";
import { normalizePositions } from "../focus/PositionsMatrix.jsx";
import { supabase } from "../../../lib/supabase.js";
import { calcDTE } from "../../../lib/trading.js";

// Left-slide drawer that shows the full EOD snapshot.
// Metadata chips, metric grid, monthly target bars, today's activity,
// open CSP snapshot, reflection body, and Delete/Edit actions.
export function EodDrawer({ entry, account, trades, positions, onClose, onDelete, onUpdate }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(entry.body || "");
  const [saving, setSaving]     = useState(false);

  // Ticker → first matching position id lookup, for click-through
  const tickerToId = useMemo(() => {
    const rows = normalizePositions(positions || {});
    const map = new Map();
    rows.forEach(r => { if (r.ticker && !map.has(r.ticker)) map.set(r.ticker, r.id); });
    return map;
  }, [positions]);

  const clickTicker = (ticker) => {
    const id = tickerToId.get(ticker);
    if (id) openPosition(id);
  };

  const meta = entry.metadata || {};
  const vix       = meta.vix ?? account?.vix_current ?? null;
  const cashPct   = meta.cashPct ?? account?.free_cash_pct_est ?? null;
  const inBand    = meta.inBand ?? null;
  const mtd       = meta.mtd ?? account?.month_to_date_premium ?? 0;
  const baseline  = account?.monthly_targets?.baseline ?? 15000;
  const stretch   = account?.monthly_targets?.stretch  ?? 25000;

  // Today's activity: derived from trades created/closed the same day as the entry
  const entryDate = entry.created_at ? new Date(entry.created_at) : null;
  const entryMmDd = entryDate
    ? entryDate.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" })
    : null;
  const activity = (trades || []).filter(t => (t.close === entryMmDd) || (t.open === entryMmDd));

  // Open CSP snapshot — best-effort current state (not historical)
  const openCsps = (positions?.open_csps || []).map(p => {
    const dte = calcDTE(p.expiry_date);
    let pctLeft = null;
    if (p.open_date && p.expiry_date && dte != null) {
      const total = Math.max(1, Math.round(
        (new Date(p.expiry_date + "T00:00:00") - new Date(p.open_date + "T00:00:00")) / 86400000
      ));
      pctLeft = Math.round((dte / total) * 100);
    }
    return {
      ticker: p.ticker, strike: p.strike, expiry: p.expiry_date,
      dte, pctLeft,
      premium: p.premium_collected, capital: p.capital_fronted,
      roi: p.roi,
    };
  });

  const basePct    = Math.min(100, (mtd / baseline) * 100);
  const stretchPct = Math.min(100, (mtd / stretch) * 100);

  const weekday = entryDate
    ? entryDate.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase()
    : "";
  const longDate = entryDate
    ? entryDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()
    : "";

  async function handleSave() {
    setSaving(true);
    const { error } = await supabase
      .from("journal_entries")
      .update({ body: editBody, updated_at: new Date().toISOString() })
      .eq("id", entry.id);
    setSaving(false);
    if (error) {
      console.warn("[EodDrawer] update failed:", error.message);
      return;
    }
    onUpdate?.({ ...entry, body: editBody });
    setEditing(false);
  }

  async function handleDelete() {
    if (!window.confirm("Delete this EOD entry?")) return;
    const { error } = await supabase.from("journal_entries").delete().eq("id", entry.id);
    if (error) {
      console.warn("[EodDrawer] delete failed:", error.message);
      return;
    }
    onDelete?.(entry.id);
    onClose();
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 95,
          animation: "edFadeIn 140ms ease",
        }}
      />
      <div style={{
        position: "fixed", top: 0, left: 0, bottom: 0, width: 640,
        maxWidth: "90vw",
        background: T.bg, borderRight: `1px solid ${T.bd}`,
        boxShadow: "8px 0 24px rgba(0,0,0,0.5)",
        zIndex: 96, overflowY: "auto",
        animation: "edSlideIn 180ms cubic-bezier(.4,0,.2,1)",
      }}>
        <div style={{ padding: "18px 24px 80px" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ fontSize: T.xs, color: T.tf, letterSpacing: "0.1em", fontFamily: T.mono }}>
              {weekday}, {longDate}
            </div>
            <button onClick={onClose} style={{
              background: "transparent", border: `1px solid ${T.bd}`, color: T.tm,
              padding: "3px 10px", fontSize: T.xs, fontFamily: T.mono, letterSpacing: "0.05em", cursor: "pointer",
            }}>✕ CLOSE · ESC</button>
          </div>

          {/* EOD UPDATE banner */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, marginBottom: 6, flexWrap: "wrap" }}>
            <span style={{
              fontSize: T.xs, letterSpacing: "0.12em", color: T.mag,
              fontFamily: T.mono, fontWeight: 600,
              padding: "3px 10px", border: `1px solid ${T.mag}55`, background: T.mag + "10",
            }}>EOD UPDATE</span>
            {entry.mood && (
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: T.amber }} />
            )}
            <span style={{ marginLeft: "auto", fontSize: T.xs, color: T.tf, fontFamily: T.mono }}>
              {entryDate?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ↑
            </span>
          </div>
          <div style={{ fontSize: T.sm, color: T.tm, fontFamily: T.mono, marginBottom: 22 }}>
            {vix != null && <>VIX <span style={{ color: T.t2 }}>{typeof vix === "number" ? vix.toFixed(2) : vix}</span> · </>}
            {cashPct != null && <>Cash <span style={{ color: T.t2 }}>{typeof cashPct === "number" ? (cashPct * 100).toFixed(1) + "%" : cashPct}</span> </>}
            {inBand === true && <span style={{ color: T.green }}>✓ in band</span>}
            {inBand === false && <span style={{ color: T.amber }}>⚠ out of band</span>}
            {mtd != null && <> · MTD <span style={{ color: T.t2 }}>${Math.round(mtd).toLocaleString()}</span></>}
            {activity.length > 0 && <> · {activity.length} closes</>}
          </div>

          {/* Metric grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginBottom: 18 }}>
            <Metric label="FREE CASH" value={cashPct != null ? (typeof cashPct === "number" ? (cashPct * 100).toFixed(1) + "%" : cashPct) : "—"} />
            <Metric
              label="DEPLOYMENT STATUS"
              value={inBand === true
                ? <span style={{ color: T.green }}>✓ in band</span>
                : inBand === false
                  ? <span style={{ color: T.amber }}>⚠ out of band</span>
                  : "—"}
              sub="Floor: 20–25%"
            />
            <Metric label="VIX" value={vix != null ? (typeof vix === "number" ? vix.toFixed(2) : vix) : "—"} />
            <Metric
              label="MTD REALIZED"
              value={<span style={{ color: T.green }}>${Math.round(mtd).toLocaleString()}</span>}
            />
            <Metric label="BASELINE" value={`$${(baseline / 1000).toFixed(0)}k`} />
            <Metric label="STRETCH" value={`$${(stretch / 1000).toFixed(0)}k`} />
          </div>

          {/* Monthly targets */}
          <SectionHead>MONTHLY TARGETS</SectionHead>
          <TargetBar label={`Baseline $${(baseline / 1000).toFixed(0)}k`} pct={basePct} color={T.green} />
          <TargetBar label={`Stretch $${(stretch / 1000).toFixed(0)}k`} pct={stretchPct} color={T.blue} />

          {/* Today's activity */}
          {activity.length > 0 && (
            <>
              <SectionHead>TODAY'S ACTIVITY</SectionHead>
              <div style={{ marginBottom: 22 }}>
                {activity.map((a, i) => (
                  <div key={i} style={{
                    display: "flex", gap: 10, alignItems: "baseline",
                    padding: "4px 0", fontSize: T.xs, fontFamily: T.mono,
                    borderBottom: i === activity.length - 1 ? "none" : `1px solid ${T.hair}`,
                  }}>
                    <span style={{ color: T.tf, letterSpacing: "0.05em", width: 56 }}>
                      {a.subtype === "Roll Loss" ? "ROLLED" : a.close === entryMmDd ? "CLOSED" : "OPENED"}
                    </span>
                    <span
                      onClick={() => clickTicker(a.ticker)}
                      style={{
                        color: T.t1, fontWeight: 600,
                        cursor: tickerToId.has(a.ticker) ? "pointer" : "default",
                        textDecoration: tickerToId.has(a.ticker) ? "underline dotted" : "none",
                        textUnderlineOffset: 3,
                      }}
                    >{a.ticker}</span>
                    <span style={{ color: T.tm }}>
                      {a.type}{a.strike ? ` $${a.strike}` : ""}{a.contracts ? ` · ${a.contracts}ct` : ""}
                    </span>
                    {a.premium != null && (
                      <span style={{ color: a.premium >= 0 ? T.green : T.red, fontWeight: 600 }}>
                        {a.premium >= 0 ? "+" : "−"}${Math.abs(a.premium).toLocaleString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Open CSP snapshot */}
          {openCsps.length > 0 && (
            <>
              <SectionHead>OPEN CSP POSITIONS <span style={{ color: T.tf, letterSpacing: "0.03em", fontWeight: 400 }}>(as of save time)</span></SectionHead>
              <div style={{ marginBottom: 22 }}>
                <div style={{
                  display: "grid", gridTemplateColumns: "56px 60px 72px 44px 54px 72px 72px 56px", gap: 8,
                  padding: "4px 2px 6px", borderBottom: `1px solid ${T.bd}`,
                  fontSize: T.xs, color: T.tf, letterSpacing: "0.08em", fontFamily: T.mono,
                }}>
                  <span>Ticker</span><span>Strike</span><span>Expiry</span><span>DTE</span><span>% Left</span>
                  <span style={{ textAlign: "right" }}>Premium</span>
                  <span style={{ textAlign: "right" }}>Capital</span>
                  <span style={{ textAlign: "right" }}>ROI</span>
                </div>
                {openCsps.map((p, i) => (
                  <div
                    key={i}
                    onClick={() => clickTicker(p.ticker)}
                    style={{
                      display: "grid", gridTemplateColumns: "56px 60px 72px 44px 54px 72px 72px 56px", gap: 8,
                      padding: "6px 2px", borderBottom: `1px solid ${T.hair}`,
                      fontSize: T.sm, fontFamily: T.mono,
                      cursor: tickerToId.has(p.ticker) ? "pointer" : "default",
                    }}
                  >
                    <span style={{ color: T.t1, fontWeight: 600 }}>{p.ticker}</span>
                    <span style={{ color: T.t2 }}>{p.strike ? `$${p.strike}` : "—"}</span>
                    <span style={{ color: T.tm }}>{p.expiry ? p.expiry.slice(5).replace("-", "/") : "—"}</span>
                    <span style={{ color: T.tm }}>{p.dte != null ? `${p.dte}d` : "—"}</span>
                    <span style={{ color: T.green }}>{p.pctLeft != null ? `${p.pctLeft}%` : "—"}</span>
                    <span style={{ color: T.green, textAlign: "right" }}>{p.premium != null ? `$${p.premium.toLocaleString()}` : "—"}</span>
                    <span style={{ color: T.t2, textAlign: "right" }}>{p.capital != null ? `$${p.capital.toLocaleString()}` : "—"}</span>
                    <span style={{ color: T.t2, textAlign: "right", fontWeight: 600 }}>{p.roi != null ? `${p.roi.toFixed(2)}%` : "—"}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Body / reflection */}
          {editing ? (
            <textarea
              value={editBody}
              onChange={e => setEditBody(e.target.value)}
              autoFocus
              style={{
                width: "100%", minHeight: 140,
                padding: 12, background: T.bg, border: `1px solid ${T.bd}`,
                color: T.t2, fontSize: T.sm, fontFamily: T.mono, lineHeight: 1.6,
                resize: "vertical", outline: "none", borderRadius: 2,
                marginBottom: 14, boxSizing: "border-box",
              }}
            />
          ) : (
            <div style={{
              fontSize: T.sm, color: T.t2, lineHeight: 1.7, fontFamily: T.mono,
              whiteSpace: "pre-wrap", marginBottom: 22,
            }}>
              {entry.body || <span style={{ color: T.tf, fontStyle: "italic" }}>(no reflection text)</span>}
            </div>
          )}

          {/* Tags */}
          {entry.tags?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 22 }}>
              {entry.tags.map(t => (
                <span key={t} style={{
                  fontSize: T.xs, padding: "2px 8px",
                  border: `1px solid ${T.mag}55`, color: T.mag,
                  background: T.mag + "10",
                  fontFamily: T.mono, letterSpacing: "0.05em",
                }}>#{t}</span>
              ))}
            </div>
          )}

          {/* Footer actions */}
          <div style={{
            display: "flex", justifyContent: "flex-end", gap: 10,
            paddingTop: 14, borderTop: `1px solid ${T.bd}`,
          }}>
            <button
              onClick={handleDelete}
              style={{
                background: "transparent", border: `1px solid ${T.bd}`, color: T.tm,
                padding: "5px 14px", fontSize: T.xs, fontFamily: T.mono,
                letterSpacing: "0.05em", cursor: "pointer",
              }}
            >Delete</button>
            {editing ? (
              <>
                <button
                  onClick={() => { setEditing(false); setEditBody(entry.body || ""); }}
                  style={{
                    background: "transparent", border: `1px solid ${T.bd}`, color: T.tm,
                    padding: "5px 14px", fontSize: T.xs, fontFamily: T.mono,
                    letterSpacing: "0.05em", cursor: "pointer",
                  }}
                >Cancel</button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    background: T.blue + "18", border: `1px solid ${T.blue}`, color: T.blue,
                    padding: "5px 14px", fontSize: T.xs, fontFamily: T.mono,
                    letterSpacing: "0.05em", cursor: saving ? "default" : "pointer",
                    fontWeight: 600,
                  }}
                >{saving ? "SAVING…" : "Save"}</button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                style={{
                  background: T.blue + "18", border: `1px solid ${T.blue}`, color: T.blue,
                  padding: "5px 14px", fontSize: T.xs, fontFamily: T.mono,
                  letterSpacing: "0.05em", cursor: "pointer",
                }}
              >Edit</button>
            )}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes edSlideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        @keyframes edFadeIn  { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </>
  );
}

function Metric({ label, value, sub }) {
  return (
    <div>
      <div style={{ fontSize: T.xs, color: T.tf, letterSpacing: "0.08em", fontFamily: T.mono, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, color: T.t1, fontFamily: T.mono, fontWeight: 600 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: T.xs, color: T.tf, marginTop: 2, fontFamily: T.mono }}>{sub}</div>}
    </div>
  );
}

function TargetBar({ label, pct, color }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 60px", gap: 12, alignItems: "center", marginBottom: 6 }}>
      <span style={{ fontSize: T.sm, color: T.tm, fontFamily: T.mono }}>{label}</span>
      <div style={{ height: 8, background: T.hair, position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: color }} />
      </div>
      <span style={{ fontSize: T.sm, color: T.t2, fontFamily: T.mono, textAlign: "right" }}>{pct.toFixed(1)}%</span>
    </div>
  );
}

function SectionHead({ children }) {
  return (
    <div style={{
      fontSize: T.xs, color: T.tf, letterSpacing: "0.12em",
      fontFamily: T.mono, fontWeight: 600,
      marginTop: 22, marginBottom: 10,
    }}>{children}</div>
  );
}
