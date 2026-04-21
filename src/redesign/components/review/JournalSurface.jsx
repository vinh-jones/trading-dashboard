import { useState, useEffect, useMemo } from "react";
import { T, getVixBand } from "../../theme.js";
import { supabase } from "../../../lib/supabase.js";
import { normalizePositions } from "../focus/PositionsMatrix.jsx";
import { JournalLedger, buildLedgerItems } from "./JournalLedger.jsx";
import { EodDrawer } from "./EodDrawer.jsx";

// ── Surface ───────────────────────────────────────────────────────────────────
export function JournalSurface({ trades, positions, account }) {
  // Feed fetched from Supabase
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedErr, setFeedErr] = useState(null);

  // Drawer + modal state
  const [openEntry, setOpenEntry]       = useState(null);
  const [ritualOpen, setRitualOpen]     = useState(false);
  const [savingTradeId, setSavingTradeId] = useState(null);

  useEffect(() => {
    supabase
      .from("journal_entries")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) setFeedErr(error.message);
        else setEntries(data || []);
        setLoading(false);
      });
  }, []);

  // Open modal via keyboard shortcut / command palette
  useEffect(() => {
    const h = () => setRitualOpen(true);
    window.addEventListener("tw-journal-new", h);
    return () => window.removeEventListener("tw-journal-new", h);
  }, []);

  const items = useMemo(() => buildLedgerItems(entries, trades), [entries, trades]);
  const eodCount  = items.filter(i => i.kind === "eod").length;
  const txnCount  = items.filter(i => i.kind === "txn").length;
  const stubCount = items.filter(i => i.kind === "stub").length;

  const todayMmDd = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" });
  const hasTodayEod = items.some(i => i.kind === "eod" && i.date === todayMmDd);

  // Reflection on a closed trade → insert journal_entries row with metadata.trade_id
  async function saveStubReflection(trade, body) {
    setSavingTradeId(trade.id);
    const payload = {
      type: "trade_note",
      body,
      ticker: trade.ticker,
      tags: [trade.ticker, trade.type].filter(Boolean),
      metadata: { trade_id: trade.id },
      created_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("journal_entries").insert(payload).select().single();
    setSavingTradeId(null);
    if (error) {
      console.warn("[JournalSurface] save stub failed:", error.message);
      return;
    }
    if (data) setEntries(prev => [data, ...prev]);
  }

  // Save a new EOD entry from the ritual modal
  async function saveEodEntry({ mood, body, tags, tomorrowPlan }) {
    const todayTrades = (trades || []).filter(t => t.close === todayMmDd || t.open === todayMmDd);
    const vix = account?.vix_current ?? null;
    const cashPct = account?.free_cash_pct_est ?? null;
    const band = vix != null ? getVixBand(vix) : null;
    const inBand = band && cashPct != null ? cashPct >= band.floorPct && cashPct <= band.ceilingPct : null;
    const fullBody = tomorrowPlan?.trim()
      ? `${body.trim()}\n\n— TOMORROW —\n${tomorrowPlan.trim()}`
      : body.trim();

    const payload = {
      type: "eod_update",
      mood,
      body: fullBody,
      tags: tags || [],
      metadata: {
        vix,
        cashPct,
        inBand,
        mtd: account?.month_to_date_premium ?? 0,
        closes: todayTrades.filter(t => t.close === todayMmDd).length,
      },
      created_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("journal_entries").insert(payload).select().single();
    if (error) {
      console.warn("[JournalSurface] save EOD failed:", error.message);
      return { ok: false, error: error.message };
    }
    if (data) setEntries(prev => [data, ...prev]);
    return { ok: true };
  }

  function handleDelete(id) {
    setEntries(prev => prev.filter(e => e.id !== id));
  }
  function handleUpdate(next) {
    setEntries(prev => prev.map(e => e.id === next.id ? next : e));
  }

  if (loading) {
    return (
      <div style={{ fontSize: T.sm, color: T.tf, fontFamily: T.mono, padding: "40px 0", textAlign: "center" }}>
        Loading journal…
      </div>
    );
  }

  if (feedErr) {
    return (
      <div style={{
        fontSize: T.sm, color: T.tf, fontFamily: T.mono,
        padding: "40px 0", textAlign: "center", lineHeight: 1.6,
      }}>
        Journal unavailable in dev mode.<br />
        <span style={{ color: T.ts, fontSize: T.xs }}>Add VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY to .env.local</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Summary bar */}
      <div style={{
        display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap",
        fontFamily: T.mono,
      }}>
        <span style={{ fontSize: T.lg, color: T.t1 }}>{items.length} entries</span>
        <span style={{ fontSize: T.xs, color: T.tf }}>·</span>
        <span style={{ fontSize: T.sm, color: T.mag }}>{eodCount} EOD</span>
        <span style={{ fontSize: T.xs, color: T.tf }}>·</span>
        <span style={{ fontSize: T.sm, color: T.blue }}>{txnCount} transaction</span>
        {stubCount > 0 && (
          <>
            <span style={{ fontSize: T.xs, color: T.tf }}>·</span>
            <span style={{ fontSize: T.sm, color: T.amber }}>{stubCount} awaiting notes</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setRitualOpen(true)}
          style={{
            fontSize: T.xs, color: T.mag,
            border: `1px solid ${T.mag}66`, background: T.mag + "10",
            padding: "5px 14px", letterSpacing: "0.1em", fontFamily: T.mono,
            fontWeight: 600, cursor: "pointer", borderRadius: T.rSm,
          }}
        >
          {hasTodayEod ? "▸ LOG AGAIN" : "▸ NEW EOD ENTRY"}
        </button>
      </div>

      <JournalLedger
        items={items}
        account={account}
        trades={trades}
        onOpenEod={setOpenEntry}
        onSaveStub={saveStubReflection}
        savingTradeId={savingTradeId}
      />

      {openEntry && (
        <EodDrawer
          entry={openEntry}
          account={account}
          trades={trades}
          positions={positions}
          onClose={() => setOpenEntry(null)}
          onDelete={handleDelete}
          onUpdate={(next) => { handleUpdate(next); setOpenEntry(next); }}
        />
      )}

      {ritualOpen && (
        <RitualModal
          account={account}
          trades={trades}
          positions={positions}
          onClose={() => setRitualOpen(false)}
          onSave={async (payload) => {
            const r = await saveEodEntry(payload);
            if (r.ok) setRitualOpen(false);
            return r;
          }}
        />
      )}
    </div>
  );
}

// ── 3-step Ritual modal ───────────────────────────────────────────────────────
const STEPS = [
  { k: "REVIEW", title: "RECAP TODAY" },
  { k: "LOG",    title: "WHAT HAPPENED" },
  { k: "PLAN",   title: "TOMORROW" },
];

function RitualModal({ account, trades, positions, onClose, onSave }) {
  const [step,         setStep]         = useState(0);
  const [mood,         setMood]         = useState("neutral");
  const [noteBody,     setNoteBody]     = useState("");
  const [tags,         setTags]         = useState([]);
  const [tomorrowNote, setTomorrowNote] = useState("");
  const [saving,       setSaving]       = useState(false);
  const [saveErr,      setSaveErr]      = useState(null);

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function handleSignOff() {
    setSaving(true); setSaveErr(null);
    const r = await onSave({ mood, body: noteBody, tags, tomorrowPlan: tomorrowNote });
    setSaving(false);
    if (!r.ok) setSaveErr(r.error || "Save failed");
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 150,
          animation: "rmFadeIn 140ms ease",
        }}
      />
      <div style={{
        position: "fixed", top: "8vh", left: "50%", transform: "translateX(-50%)",
        width: 680, maxWidth: "calc(100vw - 32px)", maxHeight: "84vh",
        background: T.bg, border: `1px solid ${T.bdS || T.bd}`,
        boxShadow: "0 20px 60px rgba(0,0,0,0.65)",
        zIndex: 151, display: "flex", flexDirection: "column",
        animation: "rmSlideIn 180ms cubic-bezier(.4,0,.2,1)",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 20px",
          borderBottom: `1px solid ${T.bd}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap",
        }}>
          <div>
            <div style={{ fontSize: T.xs, color: T.mag, letterSpacing: "0.12em", fontFamily: T.mono, fontWeight: 600 }}>
              ▸ EOD RITUAL · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            </div>
            <div style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono, marginTop: 2 }}>
              end-of-day close-out · 3 steps · ~90s
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {STEPS.map((s, i) => (
              <button
                key={i} onClick={() => setStep(i)}
                style={{
                  fontSize: T.xs, letterSpacing: "0.08em",
                  padding: "3px 9px", borderRadius: T.rSm,
                  border: `1px solid ${i === step ? T.mag : T.bd}`,
                  background: i === step ? T.mag + "18" : "transparent",
                  color: i === step ? T.mag : T.tm,
                  fontFamily: T.mono, cursor: "pointer",
                }}
              >
                {String(i + 1).padStart(2, "0")} · {s.k}
              </button>
            ))}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: T.bd, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${((step + 1) / STEPS.length) * 100}%`, background: T.mag, transition: "width 0.3s" }} />
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px" }}>
          {step === 0 && <StepReview trades={trades} account={account} positions={positions} />}
          {step === 1 && <StepLog mood={mood} setMood={setMood} noteBody={noteBody} setNoteBody={setNoteBody} tags={tags} setTags={setTags} />}
          {step === 2 && <StepPlan positions={positions} tomorrowNote={tomorrowNote} setTomorrowNote={setTomorrowNote} />}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px", borderTop: `1px solid ${T.bd}`,
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14,
        }}>
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
            style={{
              border: `1px solid ${T.bd}`, background: "transparent",
              color: step === 0 ? T.tf : T.tm,
              padding: "6px 14px", fontSize: T.xs, letterSpacing: "0.08em",
              fontFamily: T.mono, borderRadius: T.rSm,
              cursor: step === 0 ? "default" : "pointer",
              opacity: step === 0 ? 0.4 : 1,
            }}
          >◂ BACK</button>
          <div style={{ fontSize: T.xs, color: T.tm, fontFamily: T.mono, letterSpacing: "0.06em" }}>
            {saveErr ? <span style={{ color: T.red }}>{saveErr}</span> : (step === 2 ? "⏎ SAVE · SIGN OFF" : "⏎ CONTINUE")}
          </div>
          {step < 2 ? (
            <button
              onClick={() => setStep(s => Math.min(2, s + 1))}
              style={{
                border: `1px solid ${T.mag}`, background: T.mag + "22", color: T.mag,
                padding: "6px 14px", fontSize: T.xs, letterSpacing: "0.08em",
                fontFamily: T.mono, borderRadius: T.rSm, fontWeight: 600, cursor: "pointer",
              }}
            >NEXT ▸</button>
          ) : (
            <button
              onClick={handleSignOff}
              disabled={saving}
              style={{
                border: `1px solid ${T.mag}`, background: T.mag + "22", color: T.mag,
                padding: "6px 14px", fontSize: T.xs, letterSpacing: "0.08em",
                fontFamily: T.mono, borderRadius: T.rSm, fontWeight: 600,
                cursor: saving ? "default" : "pointer",
              }}
            >{saving ? "SAVING…" : "SIGN OFF ◆"}</button>
          )}
        </div>
      </div>
      <style>{`
        @keyframes rmFadeIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rmSlideIn { from { opacity: 0; transform: translate(-50%, -12px); } to { opacity: 1; transform: translate(-50%, 0); } }
      `}</style>
    </>
  );
}

// ── Step components (retained from previous implementation) ───────────────────

function DayStat({ label, value, sub, color }) {
  return (
    <div style={{ padding: "12px 11px", background: T.bg }}>
      <div style={{ fontSize: T.xs, color: T.tm, letterSpacing: "0.12em", fontFamily: T.mono }}>{label}</div>
      <div style={{ fontSize: 22, color, fontFamily: T.mono, marginTop: 4, letterSpacing: "-0.02em", fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: T.xs, color: T.ts, marginTop: 2, fontFamily: T.mono }}>{sub}</div>
    </div>
  );
}

function describeTradeAction(t) {
  const subtype = (t.subtype || "").toLowerCase();
  const premium = t.premium ?? 0;
  const strikeStr = t.strike ? `$${t.strike}` : "";
  const diffStr = premium > 0
    ? `+$${Math.round(premium).toLocaleString()} premium`
    : premium < 0 ? `-$${Math.round(-premium).toLocaleString()}` : null;

  if (subtype.includes("roll"))    return { action: `rolled ${t.type} ${strikeStr}`, diff: diffStr };
  if (subtype === "assigned")      return { action: `${t.type} ${strikeStr} assigned`, diff: null };
  if (t.open === t.close)          return { action: `${t.type} ${strikeStr} placed`, diff: diffStr };
  if (t.close && t.close !== "—")  return { action: `${t.type} ${strikeStr} closed`, diff: diffStr };
  return { action: `${t.type} ${strikeStr} opened`, diff: diffStr };
}

function StepReview({ trades, account, positions }) {
  const today = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" });
  const todayTrades = (trades || []).filter(t => t.close === today || t.open === today);
  const closed   = todayTrades.filter(t => t.close === today && !["Assigned"].includes(t.subtype)).length;
  const rolled   = todayTrades.filter(t => t.subtype && t.subtype.toLowerCase().includes("roll")).length;
  const opened   = todayTrades.filter(t => t.open === today && (!t.close || t.close === "—")).length;
  const captured = todayTrades.reduce((s, t) => s + (t.premium ?? 0), 0);
  const cashPct  = account?.free_cash_pct_est ?? account?.free_cash_pct ?? null;
  const invested = cashPct != null ? 1 - cashPct : null;

  return (
    <div>
      <div style={{ fontSize: T.xs, color: T.mag, letterSpacing: "0.12em", marginBottom: 10, fontFamily: T.mono }}>▸ TODAY AT A GLANCE</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: T.bd, border: `1px solid ${T.bd}`, marginBottom: 18 }}>
        <DayStat label="CLOSED"   value={String(closed)}   sub="trades"     color={T.green} />
        <DayStat label="ROLLED"   value={String(rolled)}   sub="positions"  color={T.blue}  />
        <DayStat label="OPENED"   value={String(opened)}   sub="new trades" color={T.t1}    />
        <DayStat label="CAPTURED" value={captured !== 0 ? `$${Math.abs(captured).toLocaleString()}` : "—"} sub="premium" color={captured >= 0 ? T.green : T.red} />
      </div>

      {cashPct != null && (
        <>
          <div style={{ fontSize: T.xs, color: T.mag, letterSpacing: "0.12em", marginBottom: 10, fontFamily: T.mono }}>▸ CASH POSTURE</div>
          <div style={{
            padding: 14, background: T.bg, border: `1px solid ${T.bd}`,
            display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 20, alignItems: "center", marginBottom: 18,
          }}>
            <div>
              <div style={{ fontSize: T.xs, color: T.tm, letterSpacing: "0.12em", fontFamily: T.mono }}>CASH</div>
              <div style={{ fontSize: 22, color: T.amber, fontFamily: T.mono, marginTop: 3, fontWeight: 600 }}>{(cashPct * 100).toFixed(1)}%</div>
            </div>
            <div style={{ fontSize: 18, color: T.tf, fontFamily: T.mono }}>·</div>
            <div>
              <div style={{ fontSize: T.xs, color: T.tm, letterSpacing: "0.12em", fontFamily: T.mono }}>INVESTED</div>
              <div style={{ fontSize: 22, color: T.green, fontFamily: T.mono, marginTop: 3, fontWeight: 600 }}>
                {invested != null ? (invested * 100).toFixed(1) : "—"}%
              </div>
            </div>
          </div>
        </>
      )}

      {todayTrades.length > 0 ? (
        <>
          <div style={{ fontSize: T.xs, color: T.mag, letterSpacing: "0.12em", marginBottom: 10, fontFamily: T.mono }}>▸ RESOLVED TODAY</div>
          <div style={{ display: "grid", gap: 1, background: T.bd, border: `1px solid ${T.bd}` }}>
            {todayTrades.map((t, i) => {
              const { action, diff } = describeTradeAction(t);
              return (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "60px 1fr auto", gap: 12,
                  padding: "10px 14px", background: T.surf, alignItems: "center",
                }}>
                  <span style={{ fontSize: T.sm, fontWeight: 600, color: T.t1, fontFamily: T.mono }}>{t.ticker}</span>
                  <span style={{ fontSize: T.sm, color: T.t2, fontFamily: T.mono }}>{action}</span>
                  {diff && (
                    <span style={{ fontSize: T.xs, color: (t.premium ?? 0) >= 0 ? T.green : T.red, fontFamily: T.mono }}>{diff}</span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ padding: "20px 0", fontSize: T.sm, color: T.tf, fontFamily: T.mono, textAlign: "center" }}>
          No activity today — close a position or open a new CSP to populate the ritual.
        </div>
      )}
    </div>
  );
}

const MOODS = [
  { k: "focused",   label: "FOCUSED",   color: T.blue  },
  { k: "confident", label: "CONFIDENT", color: T.green },
  { k: "neutral",   label: "NEUTRAL",   color: T.tm    },
  { k: "cautious",  label: "CAUTIOUS",  color: T.amber },
  { k: "rattled",   label: "RATTLED",   color: T.red   },
];
const SUGGESTED_TAGS = ["discipline", "lesson", "wheel-cycle", "earnings-hold", "breakout", "patience"];

function StepLog({ mood, setMood, noteBody, setNoteBody, tags, setTags }) {
  const [tagInput, setTagInput] = useState("");
  const addTag = (t) => {
    const clean = t.trim().replace(/^#/, "").toLowerCase();
    if (!clean || tags.includes(clean)) return;
    setTags([...tags, clean]);
  };
  const removeTag = (t) => setTags(tags.filter(x => x !== t));
  const handleTagKey = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
      setTagInput("");
    }
  };

  return (
    <div>
      <div style={{ fontSize: T.xs, color: T.mag, letterSpacing: "0.12em", marginBottom: 10, fontFamily: T.mono }}>▸ HOW DID TODAY FEEL?</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
        {MOODS.map(m => (
          <button key={m.k} onClick={() => setMood(m.k)} style={{
            padding: "6px 14px",
            border: `1px solid ${mood === m.k ? m.color : T.bd}`,
            background: mood === m.k ? m.color + "22" : "transparent",
            color: mood === m.k ? m.color : T.tm,
            fontSize: T.xs, letterSpacing: "0.08em", fontWeight: 600, fontFamily: T.mono,
            cursor: "pointer", borderRadius: T.rSm,
          }}>{m.label}</button>
        ))}
      </div>

      <div style={{ fontSize: T.xs, color: T.mag, letterSpacing: "0.12em", marginBottom: 10, fontFamily: T.mono }}>▸ NOTES</div>
      <textarea
        value={noteBody}
        onChange={e => setNoteBody(e.target.value)}
        placeholder="What was the thinking? What did you learn? What surprised you?"
        style={{
          width: "100%", minHeight: 140,
          padding: 12, background: T.bg, border: `1px solid ${T.bd}`,
          color: T.t2, fontSize: T.sm, fontFamily: T.mono, lineHeight: 1.55,
          resize: "vertical", outline: "none", borderRadius: 2, boxSizing: "border-box",
        }}
      />

      <div style={{ marginTop: 16, fontSize: T.xs, color: T.mag, letterSpacing: "0.12em", marginBottom: 10, fontFamily: T.mono }}>▸ TAGS</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {tags.map(t => (
          <span key={t} onClick={() => removeTag(t)} style={{
            fontSize: T.xs, padding: "3px 9px",
            border: `1px solid ${T.mag}66`, color: T.mag,
            background: T.mag + "12", letterSpacing: "0.04em",
            cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: T.mono,
          }}>#{t} <span style={{ color: T.tf, fontSize: 9 }}>×</span></span>
        ))}
        <input
          value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          onKeyDown={handleTagKey}
          placeholder="+ add tag, Enter"
          style={{
            background: "transparent", border: `1px dashed ${T.bd}`,
            color: T.t2, fontSize: T.xs, fontFamily: T.mono, padding: "3px 9px",
            outline: "none", minWidth: 100,
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {SUGGESTED_TAGS.filter(t => !tags.includes(t)).map(t => (
          <span key={t} onClick={() => addTag(t)} style={{
            fontSize: T.xs, padding: "3px 9px",
            border: `1px dashed ${T.bd}`, color: T.tf,
            letterSpacing: "0.04em", cursor: "pointer", fontFamily: T.mono,
          }}>#{t}</span>
        ))}
      </div>
    </div>
  );
}

function StepPlan({ positions, tomorrowNote, setTomorrowNote }) {
  const posRows = normalizePositions(positions || {});
  const queue = posRows
    .filter(p => p.priority === "P1" || p.priority === "P2" || (typeof p.dte === "number" && p.dte <= 7))
    .slice(0, 6);

  return (
    <div>
      <div style={{ fontSize: T.xs, color: T.mag, letterSpacing: "0.12em", marginBottom: 10, fontFamily: T.mono }}>▸ UPCOMING QUEUE</div>
      {queue.length === 0 ? (
        <div style={{
          padding: "12px 14px", background: T.surf, border: `1px solid ${T.bd}`,
          fontSize: T.sm, color: T.tf, fontFamily: T.mono, marginBottom: 18,
        }}>
          No urgent positions — nothing expiring soon.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 1, background: T.bd, border: `1px solid ${T.bd}`, marginBottom: 18 }}>
          {queue.map(p => (
            <div key={p.id} style={{
              display: "grid", gridTemplateColumns: "64px 1fr auto", gap: 12,
              padding: "11px 14px", background: T.surf, alignItems: "center",
            }}>
              <span style={{ fontSize: T.sm, fontWeight: 600, color: T.t1, fontFamily: T.mono }}>{p.ticker}</span>
              <span style={{ fontSize: T.xs, color: T.t2, fontFamily: T.mono }}>
                {p.type}{p.strike ? ` $${p.strike}` : ""}{typeof p.dte === "number" && ` · ${p.dte}d DTE`}
              </span>
              <span style={{
                fontSize: 9, fontFamily: T.mono, letterSpacing: "0.06em",
                color: p.priority === "P1" ? T.red : p.priority === "P2" ? T.amber : T.tm,
              }}>{p.priority || "—"}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: T.xs, color: T.mag, letterSpacing: "0.12em", marginBottom: 10, fontFamily: T.mono }}>▸ GAME PLAN</div>
      <textarea
        value={tomorrowNote}
        onChange={e => setTomorrowNote(e.target.value)}
        placeholder="Where's your head at for tomorrow? What's the first thing to check?"
        style={{
          width: "100%", minHeight: 100,
          padding: 12, background: T.bg, border: `1px solid ${T.bd}`,
          color: T.t2, fontSize: T.sm, fontFamily: T.mono, lineHeight: 1.55,
          resize: "vertical", outline: "none", borderRadius: 2, boxSizing: "border-box",
        }}
      />

      <div style={{
        marginTop: 18, padding: 14,
        background: T.mag + "0d", border: `1px dashed ${T.mag}66`, lineHeight: 1.6,
      }}>
        <span style={{ color: T.mag, letterSpacing: "0.1em", fontSize: T.xs, fontWeight: 600, fontFamily: T.mono }}>▸ SIGN-OFF</span>
        <div style={{ marginTop: 8, fontSize: T.sm, color: T.t2, fontFamily: T.mono }}>
          Complete the ritual and save this entry to your journal. Tomorrow's you will thank you.
        </div>
      </div>
    </div>
  );
}
