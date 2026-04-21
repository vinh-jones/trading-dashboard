import { useState, useEffect } from "react";
import { T } from "../../theme.js";
import { Frame } from "../../primitives.jsx";
import { supabase } from "../../../lib/supabase.js";
import { normalizePositions } from "../focus/PositionsMatrix.jsx";

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayLabel() {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "long" })
    .replace(",", " ·");
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

// ── Step 0: RECAP TODAY ───────────────────────────────────────────────────────

function DayStat({ label, value, sub, color }) {
  return (
    <div style={{ padding: "12px 11px", background: T.bg }}>
      <div style={{ fontSize: T.xs, color: T.tm, letterSpacing: "0.15em", fontFamily: T.mono }}>{label}</div>
      <div style={{ fontSize: 22, color, fontFamily: T.mono, marginTop: 4, letterSpacing: "-0.02em", fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: T.xs, color: T.ts, marginTop: 2, fontFamily: T.mono }}>{sub}</div>
    </div>
  );
}

// Format one of today's trades into a human action + P/L diff string
function describeTradeAction(t) {
  const subtype = (t.subtype || "").toLowerCase();
  const premium = t.premium ?? 0;
  const strikeStr = t.strike ? `$${t.strike}` : "";
  const diffStr = premium > 0
    ? `+$${Math.round(premium).toLocaleString()} premium`
    : premium < 0
      ? `-$${Math.round(-premium).toLocaleString()}`
      : null;

  if (subtype.includes("roll"))    return { action: `rolled ${t.type} ${strikeStr}`, diff: diffStr };
  if (subtype === "assigned")      return { action: `${t.type} ${strikeStr} assigned`, diff: null };
  if (t.open === t.close)          return { action: `${t.type} ${strikeStr} placed`, diff: diffStr };
  if (t.close && t.close !== "—")  return { action: `${t.type} ${strikeStr} closed`, diff: diffStr };
  return { action: `${t.type} ${strikeStr} opened`, diff: diffStr };
}

function StepReview({ trades, account, positions }) {
  const today = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" });

  const todayTrades = (trades || []).filter(t => {
    const close = t.close || "";
    return close === today || t.open === today;
  });

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
          <div style={{ padding: 14, background: T.bg, border: `1px solid ${T.bd}`, display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 20, alignItems: "center", marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: T.xs, color: T.tm, letterSpacing: "0.15em", fontFamily: T.mono }}>CASH</div>
              <div style={{ fontSize: 22, color: T.amber, fontFamily: T.mono, marginTop: 3, fontWeight: 600 }}>{(cashPct * 100).toFixed(1)}%</div>
            </div>
            <div style={{ fontSize: 18, color: T.tf, fontFamily: T.mono }}>·</div>
            <div>
              <div style={{ fontSize: T.xs, color: T.tm, letterSpacing: "0.15em", fontFamily: T.mono }}>INVESTED</div>
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
                <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 1fr auto", gap: 12, padding: "10px 14px", background: T.surf, alignItems: "center" }}>
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

// ── Step 1: LOG ───────────────────────────────────────────────────────────────

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
            fontSize: T.xs, letterSpacing: "0.1em", fontWeight: 600, fontFamily: T.mono,
            cursor: "pointer",
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
          resize: "vertical", outline: "none", borderRadius: 2,
          boxSizing: "border-box",
        }}
      />

      <div style={{ marginTop: 16, fontSize: T.xs, color: T.mag, letterSpacing: "0.12em", marginBottom: 10, fontFamily: T.mono }}>▸ TAGS</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {tags.map(t => (
          <span key={t} onClick={() => removeTag(t)} style={{
            fontSize: T.xs, padding: "3px 9px", border: `1px solid ${T.mag}66`, color: T.mag,
            background: T.mag + "12", letterSpacing: "0.06em", cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 5, fontFamily: T.mono,
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
            fontSize: T.xs, padding: "3px 9px", border: `1px dashed ${T.bd}`, color: T.tf,
            letterSpacing: "0.06em", cursor: "pointer", fontFamily: T.mono,
          }}>#{t}</span>
        ))}
      </div>
    </div>
  );
}

// ── Step 2: PLAN ──────────────────────────────────────────────────────────────

function StepPlan({ positions, tomorrowNote, setTomorrowNote }) {
  const posRows = normalizePositions(positions || {});
  const queue = posRows
    .filter(p => p.priority === "P1" || p.priority === "P2" || (typeof p.dte === "number" && p.dte <= 7))
    .slice(0, 6);

  return (
    <div>
      <div style={{ fontSize: T.xs, color: T.mag, letterSpacing: "0.12em", marginBottom: 10, fontFamily: T.mono }}>▸ UPCOMING QUEUE</div>
      {queue.length === 0 ? (
        <div style={{ padding: "12px 14px", background: T.surf, border: `1px solid ${T.bd}`, fontSize: T.sm, color: T.tf, fontFamily: T.mono, marginBottom: 18 }}>
          No urgent positions — nothing expiring soon.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 1, background: T.bd, border: `1px solid ${T.bd}`, marginBottom: 18 }}>
          {queue.map(p => (
            <div key={p.id} style={{ display: "grid", gridTemplateColumns: "64px 1fr auto", gap: 12, padding: "11px 14px", background: T.surf, alignItems: "center" }}>
              <span style={{ fontSize: T.sm, fontWeight: 600, color: T.t1, fontFamily: T.mono }}>{p.ticker}</span>
              <span style={{ fontSize: T.xs, color: T.t2, fontFamily: T.mono }}>
                {p.type}{p.strike ? ` $${p.strike}` : ""}
                {typeof p.dte === "number" && ` · ${p.dte}d DTE`}
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
          resize: "vertical", outline: "none", borderRadius: 2,
          boxSizing: "border-box",
        }}
      />

      <div style={{ marginTop: 18, padding: 14, background: T.mag + "0d", border: `1px dashed ${T.mag}66`, lineHeight: 1.6 }}>
        <span style={{ color: T.mag, letterSpacing: "0.12em", fontSize: T.xs, fontWeight: 600, fontFamily: T.mono }}>▸ SIGN-OFF</span>
        <div style={{ marginTop: 8, fontSize: T.sm, color: T.t2, fontFamily: T.mono }}>
          Complete the ritual and save this entry to your journal. Tomorrow's you will thank you.
        </div>
      </div>
    </div>
  );
}

// ── Journal feed ──────────────────────────────────────────────────────────────

const TYPE_COLOR = { eod_update: T.mag, trade_note: T.blue, position_note: T.cyan };
const TYPE_LABEL = { eod_update: "EOD", trade_note: "TRADE", position_note: "NOTE" };
const MOOD_COLOR = { focused: T.blue, confident: T.green, neutral: T.tm, cautious: T.amber, rattled: T.red };

function JournalFeed({ entries, loading, error }) {
  if (loading) {
    return (
      <Frame accent="journal" title="RECENT ENTRIES" subtitle="loading…">
        <div style={{ fontSize: T.sm, color: T.tf, fontFamily: T.mono, padding: "20px 0", textAlign: "center" }}>
          Fetching journal entries…
        </div>
      </Frame>
    );
  }

  if (error) {
    return (
      <Frame accent="journal" title="RECENT ENTRIES" subtitle="journal feed">
        <div style={{ fontSize: T.sm, color: T.tf, fontFamily: T.mono, padding: "20px 0", textAlign: "center", lineHeight: 1.6 }}>
          Journal unavailable in dev mode.<br />
          <span style={{ color: T.ts, fontSize: T.xs }}>Add VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY to .env.local</span>
        </div>
      </Frame>
    );
  }

  return (
    <Frame accent="journal" title="RECENT ENTRIES" subtitle={`${entries.length} entries · newest first`}>
      {entries.length === 0 ? (
        <div style={{ fontSize: T.sm, color: T.tf, fontFamily: T.mono, padding: "20px 0", textAlign: "center" }}>
          No entries yet — complete the EOD ritual to log your first entry.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 600, overflowY: "auto" }}>
          {entries.map(e => <JournalEntryCard key={e.id} e={e} />)}
        </div>
      )}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.bd}`, fontSize: T.xs, color: T.tf, textAlign: "center", letterSpacing: "0.15em", fontFamily: T.mono }}>
        — END OF FEED —
      </div>
    </Frame>
  );
}

function JournalEntryCard({ e }) {
  const typeColor = TYPE_COLOR[e.type] || T.bd;
  const moodColor = MOOD_COLOR[e.mood] || T.tm;
  return (
    <div style={{
      padding: "11px 12px",
      background: T.surf,
      border: `1px solid ${T.bd}`,
      borderLeft: `2px solid ${typeColor}`,
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: T.xs, color: typeColor, letterSpacing: "0.15em", fontWeight: 600, fontFamily: T.mono }}>
            {TYPE_LABEL[e.type] || e.type?.toUpperCase()}
          </span>
          <span style={{ fontSize: T.xs, color: T.ts, fontFamily: T.mono }}>{fmtDate(e.created_at)}</span>
        </div>
        {e.mood && (
          <span style={{ fontSize: T.xs, color: moodColor, letterSpacing: "0.1em", fontFamily: T.mono }}>
            ◆ {e.mood.toUpperCase()}
          </span>
        )}
      </div>
      {e.title && (
        <div style={{ fontSize: T.sm, color: T.t1, fontFamily: T.mono, fontWeight: 600, marginTop: 6 }}>{e.title}</div>
      )}
      {e.body && (
        <div style={{ fontSize: T.sm, color: T.t2, lineHeight: 1.55, marginTop: 6, fontFamily: T.mono }}>{e.body}</div>
      )}
      {e.tags?.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", gap: 5, flexWrap: "wrap" }}>
          {e.tags.map(t => (
            <span key={t} style={{ fontSize: T.xs, color: T.tf, letterSpacing: "0.05em", fontFamily: T.mono }}>#{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main ritual component ─────────────────────────────────────────────────────

const STEPS = [
  { k: "REVIEW", title: "RECAP TODAY"   },
  { k: "LOG",    title: "WHAT HAPPENED" },
  { k: "PLAN",   title: "TOMORROW"      },
];

export function JournalSurface({ trades, positions, account }) {
  const [step,         setStep]         = useState(0);
  const [mood,         setMood]         = useState("neutral");
  const [noteBody,     setNoteBody]     = useState("");
  const [tags,         setTags]         = useState([]);
  const [tomorrowNote, setTomorrowNote] = useState("");
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState(null);

  // Feed
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedErr, setFeedErr] = useState(null);

  useEffect(() => {
    supabase
      .from("journal_entries")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) { setFeedErr(error.message); }
        else { setEntries(data || []); }
        setLoading(false);
      });
  }, []);

  const handleNext = async () => {
    if (step < 2) { setStep(s => s + 1); return; }
    // Step 2 → sign off → save
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload = {
        type: "eod_update",
        mood,
        body: [noteBody, tomorrowNote ? `\n\nGame plan: ${tomorrowNote}` : ""].join("").trim(),
        tags,
        title: `EOD · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
        source: "redesign",
        metadata: { game_plan: tomorrowNote },
      };
      const { data, error } = await supabase.from("journal_entries").insert(payload).select().single();
      if (error) throw error;
      setEntries(prev => [data, ...prev]);
      setSaveMsg("✓ Entry saved.");
      // Reset
      setStep(0);
      setMood("neutral");
      setNoteBody("");
      setTags([]);
      setTomorrowNote("");
    } catch (err) {
      setSaveMsg(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 14 }}>
      {/* Left: ritual */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <Frame accent="journal" title={`EOD RITUAL · ${todayLabel().toUpperCase()}`} subtitle="end-of-day close-out · 3 steps · ~90s"
          right={
            <div style={{ display: "flex", gap: 4 }}>
              {STEPS.map((s, i) => (
                <button key={i} onClick={() => setStep(i)} style={{
                  fontSize: 9, letterSpacing: "0.1em",
                  padding: "3px 9px",
                  border: `1px solid ${i === step ? T.mag : T.bd}`,
                  background: i === step ? T.mag + "18" : "transparent",
                  color: i === step ? T.mag : T.tm,
                  fontFamily: T.mono, cursor: "pointer",
                }}>
                  {String(i + 1).padStart(2, "0")} · {s.k}
                </button>
              ))}
            </div>
          }
        >
          {/* Progress bar */}
          <div style={{ height: 3, background: T.bd, borderRadius: 1, marginBottom: 18, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${((step + 1) / STEPS.length) * 100}%`,
              background: T.mag,
              transition: "width 0.3s",
            }} />
          </div>

          {step === 0 && <StepReview trades={trades} account={account} positions={positions} />}
          {step === 1 && <StepLog mood={mood} setMood={setMood} noteBody={noteBody} setNoteBody={setNoteBody} tags={tags} setTags={setTags} />}
          {step === 2 && <StepPlan positions={positions} tomorrowNote={tomorrowNote} setTomorrowNote={setTomorrowNote} />}

          {/* Nav buttons */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginTop: 20, paddingTop: 14, borderTop: `1px solid ${T.bd}`,
          }}>
            <button
              disabled={step === 0}
              onClick={() => setStep(s => Math.max(0, s - 1))}
              style={{
                border: `1px solid ${T.bd}`, background: "transparent",
                color: step === 0 ? T.tf : T.tm,
                padding: "6px 16px", fontSize: T.xs, letterSpacing: "0.1em",
                fontFamily: T.mono, cursor: step === 0 ? "default" : "pointer",
                opacity: step === 0 ? 0.4 : 1,
              }}
            >◂ BACK</button>

            <div style={{ fontSize: T.xs, color: T.tm, letterSpacing: "0.08em", fontFamily: T.mono }}>
              {saveMsg ? (
                <span style={{ color: saveMsg.startsWith("✓") ? T.green : T.red }}>{saveMsg}</span>
              ) : step === 2 ? "↵ SAVE · SIGN OFF" : "↵ CONTINUE"}
            </div>

            <button
              onClick={handleNext}
              disabled={saving}
              style={{
                border: `1px solid ${T.mag}`, background: T.mag + "22", color: T.mag,
                padding: "6px 16px", fontSize: T.xs, letterSpacing: "0.1em",
                fontFamily: T.mono, fontWeight: 600, cursor: saving ? "wait" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >{saving ? "SAVING…" : step === 2 ? "SIGN OFF ◆" : "NEXT ▸"}</button>
          </div>
        </Frame>
      </div>

      {/* Right: feed */}
      <div>
        <JournalFeed entries={entries} loading={loading} error={feedErr} />
      </div>
    </div>
  );
}
