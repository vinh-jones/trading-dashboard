import { useState, useEffect, useMemo } from "react";
import { useLiveVix } from "../../hooks/useLiveVix";
import { useQuotes } from "../../hooks/useQuotes";
import { generateFocusItems } from "../../lib/focusEngine";
import { formatDollars, formatExpiry } from "../../lib/format";
import { calcDTE, computeEodMetadata } from "../../lib/trading";
import { getVixBand } from "../../lib/vixBand";
import { TYPE_COLORS, SUBTYPE_LABELS } from "../../lib/constants";
import { supabase } from "../../lib/supabase";
import { MOODS, JOURNAL_ENTRY_TYPES, JOURNAL_INPUT_ST, JOURNAL_LABEL_ST } from "./journalConstants";
import { todayISO, buildAutoTitle } from "./journalHelpers";
import { JournalField } from "./JournalField";
import { JournalAutoTextarea } from "./JournalAutoTextarea";
import { theme } from "../../lib/theme";
import { TagCategoryLegend } from "./TagCategoryLegend";
import { TagInput } from "./TagInput";
import { useTagVocabulary } from "../../lib/tags";

export function JournalQuickAdd({
  isOpen,
  onOpen,
  onClose,
  trades,
  positions,
  account,
  journalIntent,
  onJournalIntentConsumed,
  onEntryCreated,
}) {
  // ── Form state (moved from JournalTab) ──
  const [entryType,      setEntryType]      = useState("trade_note");
  const [hoveredType,    setHoveredType]    = useState(null);
  const [linkedPosition, setLinkedPosition] = useState(null);
  const [linkedTrade,    setLinkedTrade]    = useState(null);
  const [formTitle,      setFormTitle]      = useState("");
  const [formSource,     setFormSource]     = useState("Self");
  const [formTags,       setFormTags]       = useState([]);
  const [formDate,       setFormDate]       = useState(todayISO());
  const [formBody,       setFormBody]       = useState("");
  const [saving,         setSaving]         = useState(false);
  const [saveError,      setSaveError]      = useState(null);
  const [formMood,       setFormMood]       = useState("🟡");
  const [cancelHovered,  setCancelHovered]  = useState(false);
  const [hoveredMood,    setHoveredMood]    = useState(null);

  const { vocabulary } = useTagVocabulary();

  // ── EOD auto-populated values ──
  const eodAutoFreeCash = useMemo(() =>
    account?.free_cash_pct_est != null ? +(account.free_cash_pct_est * 100).toFixed(1) : null,
  [account]);

  const { vix: eodAutoVix } = useLiveVix(account?.vix_current ?? null);
  const { quoteMap } = useQuotes();

  const eodAutoPipeline = useMemo(() => {
    const csps = (positions.open_csps || []).reduce((sum, p) => sum + (p.premium_collected || 0), 0);
    const ccs  = (positions.assigned_shares || []).reduce((sum, s) => sum + (s.active_cc?.premium_collected || 0), 0);
    return csps + ccs;
  }, [positions]);

  // ── EOD preview data ──
  const eodClosedToday = useMemo(() => {
    const dateKey = formDate;
    return trades
      .filter(t => t.closeDate?.toISOString().slice(0, 10) === dateKey)
      .map(t => {
        const dteRemaining = t.expiry_date && t.closeDate
          ? Math.max(0, Math.ceil(
              (new Date(t.expiry_date + "T12:00:00") - t.closeDate) / 86400000
            ))
          : null;
        return {
          ticker:        t.ticker,
          type:          t.type,
          strike:        t.strike,
          pct_kept:      t.kept !== "—" ? Math.round(parseFloat(t.kept)) : null,
          dte_remaining: dteRemaining,
        };
      });
  }, [trades, formDate]);

  const eodOpenedToday = useMemo(() => {
    const dateKey = formDate;
    return (positions.open_csps || [])
      .filter(p => p.open_date === dateKey)
      .map(p => ({
        ticker:  p.ticker,
        type:    p.type,
        strike:  p.strike,
        expiry:  p.expiry_date,
        premium: p.premium_collected,
      }));
  }, [positions, formDate]);

  const eodOpenCsps = useMemo(() => {
    const refDate = formDate || todayISO();
    return (positions.open_csps || [])
      .filter(p => p.type === "CSP")
      .map(p => {
        const expiryMs  = new Date(p.expiry_date + "T12:00:00").getTime();
        const refMs     = new Date(refDate        + "T12:00:00").getTime();
        const openMs    = new Date(p.open_date    + "T12:00:00").getTime();
        const dte       = Math.max(0, Math.ceil((expiryMs - refMs)  / 86400000));
        const totalDays = Math.max(1, Math.ceil((expiryMs - openMs) / 86400000));
        const dte_pct   = Math.round(dte / totalDays * 100);
        const roi       = p.capital_fronted > 0
          ? +(p.premium_collected / p.capital_fronted * 100).toFixed(2)
          : 0;
        return {
          ticker:  p.ticker,
          strike:  p.strike,
          expiry:  p.expiry_date,
          dte,
          dte_pct,
          premium: p.premium_collected,
          capital: p.capital_fronted,
          roi,
        };
      });
  }, [positions, formDate]);

  const eodDeploymentPreview = useMemo(() => {
    if (eodAutoVix == null || eodAutoFreeCash == null) return null;
    const band     = getVixBand(eodAutoVix);
    if (!band) return null;
    const cashFrac = eodAutoFreeCash / 100;
    const status   =
      cashFrac > band.ceilingPct ? "above"
      : cashFrac < band.floorPct ? "below"
      : "within";
    const delta =
      status === "above" ? +(cashFrac - band.ceilingPct).toFixed(3)
      : status === "below" ? +(band.floorPct - cashFrac).toFixed(3)
      : null;
    return { band, status, delta };
  }, [eodAutoFreeCash, eodAutoVix]);

  // ── Derived data (moved from JournalTab) ──
  const positionOptions = useMemo(() => {
    const opts = [];
    (positions.open_csps || []).forEach(p => opts.push({
      label: `${p.ticker} CSP $${p.strike} exp ${formatExpiry(p.expiry_date)}`,
      ticker: p.ticker, obj: p, group: "Open CSPs",
    }));
    (positions.assigned_shares || []).forEach(s => {
      if (s.active_cc) opts.push({
        label: `${s.ticker} CC $${s.active_cc.strike} exp ${formatExpiry(s.active_cc.expiry_date)}`,
        ticker: s.ticker, obj: s.active_cc, group: "Active CCs",
      });
      opts.push({
        label: `${s.ticker} Shares — ${formatDollars(s.cost_basis_total)}`,
        ticker: s.ticker, obj: { ...s, type: "Shares" }, group: "Assigned Shares",
      });
    });
    (positions.open_leaps || []).forEach(l => opts.push({
      label: `${l.ticker} LEAPS — ${l.description || ""}`,
      ticker: l.ticker, obj: l, group: "Open LEAPS",
    }));
    return opts;
  }, [positions]);

  const closedTradeOptions = useMemo(() =>
    [...trades]
      .sort((a, b) => (b.closeDate ?? 0) - (a.closeDate ?? 0))
      .map(t => ({
        label: `${t.ticker} ${t.type}${t.strike ? ` $${t.strike}` : ""} — ${t.close} (${t.kept})`,
        ticker: t.ticker, obj: t,
      })),
  [trades]);

  // ── Journal intent handling (moved from JournalTab, extended for new_entry) ──
  useEffect(() => {
    if (journalIntent === "eod_update") {
      setEntryType("eod_update");
      onOpen();
      onJournalIntentConsumed?.();
    } else if (journalIntent === "new_entry") {
      onOpen();
      onJournalIntentConsumed?.();
    }
  }, [journalIntent, onJournalIntentConsumed, onOpen]);

  // ── Esc closes the bloom ──
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // ── Handlers (moved from JournalTab) ──
  function resetForm() {
    setFormTitle(""); setFormBody(""); setFormTags(""); setFormSource("Self");
    setLinkedPosition(null); setLinkedTrade(null);
    setFormDate(todayISO());
    setFormMood("🟡");
    setSaveError(null);
  }

  function handleLinkPosition(posOpt) {
    setLinkedPosition(posOpt ? posOpt.obj : null);
    setLinkedTrade(null);
    if (posOpt) setFormTitle(buildAutoTitle(entryType, posOpt.obj, null));
  }

  function handleLinkTrade(tradeOpt) {
    setLinkedTrade(tradeOpt ? tradeOpt.obj : null);
    setLinkedPosition(null);
    if (tradeOpt) setFormTitle(buildAutoTitle(entryType, null, tradeOpt.obj));
  }

  async function handleSave() {
    const isEOD = entryType === "eod_update";
    const titleToSave = isEOD ? `EOD — ${formDate}` : formTitle.trim();
    if (!isEOD && !titleToSave) { setSaveError("Title is required."); return; }
    if (!formBody.trim())       { setSaveError("Notes are required."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const tags = formTags;
      const ticker = linkedPosition?.ticker ?? linkedTrade?.ticker ?? null;
      const now    = new Date().toISOString();
      const src    = isEOD ? null : (formSource || null);
      const mood   = isEOD ? formMood : null;

      const metadata = isEOD ? computeEodMetadata({
        freeCashPct:   eodAutoFreeCash,
        vix:           eodAutoVix,
        pipelineTotal: eodAutoPipeline,
        mtdRealized:   account?.month_to_date_premium ?? null,
        activity:      { closed: eodClosedToday, opened: eodOpenedToday },
        cspSnapshot:   eodOpenCsps,
      }) : null;

      const focusSnapshot = isEOD
        ? generateFocusItems(positions, account, null, eodAutoVix, quoteMap)
        : null;

      const payload = {
        entry_type:      entryType,
        trade_id:        null,
        position_id:     linkedPosition?.id ?? null,
        entry_date:      formDate,
        ticker,
        title:           titleToSave,
        body:            formBody.trim(),
        tags,
        source:          src,
        mood,
        metadata,
        focus_snapshot:  focusSnapshot,
        created_at:      now,
        updated_at:      now,
      };
      const { data, error } = await supabase
        .from("journal_entries")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      resetForm();
      onEntryCreated?.();
      onClose();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Current select indices for position/trade dropdowns
  const posSelectIdx   = linkedPosition ? positionOptions.findIndex(o => o.obj === linkedPosition) : -1;
  const tradeSelectIdx = linkedTrade    ? closedTradeOptions.findIndex(o => o.obj === linkedTrade) : -1;

  const posSelectEl = (label, optional = true) => (
    <JournalField label={label}>
      <select
        style={JOURNAL_INPUT_ST}
        value={posSelectIdx >= 0 ? posSelectIdx : ""}
        onChange={e => handleLinkPosition(e.target.value !== "" ? positionOptions[+e.target.value] : null)}
      >
        <option value="">{optional ? "— none —" : "— select position —"}</option>
        {positionOptions.map((o, i) => <option key={i} value={i}>[{o.group}] {o.label}</option>)}
      </select>
    </JournalField>
  );

  // ── Collapsed bar ──
  if (!isOpen) {
    return (
      <button
        onClick={onOpen}
        style={{
          display: "flex", alignItems: "center", gap: theme.space[2], width: "100%",
          padding: `${theme.space[2]}px ${theme.space[3]}px`,
          background: theme.bg.surface,
          border: `1px solid ${theme.border.default}`,
          borderRadius: theme.radius.md,
          color: theme.text.subtle,
          fontFamily: "inherit",
          fontSize: theme.size.sm,
          cursor: "text",
          marginBottom: theme.space[4],
          textAlign: "left",
          transition: "background 0.15s, border-color 0.15s",
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "rgba(58,130,246,0.06)"}
        onMouseLeave={(e) => e.currentTarget.style.background = theme.bg.surface}
      >
        <span style={{ color: theme.blue, fontWeight: 600 }}>+</span>
        <span>New entry…</span>
        <span style={{
          marginLeft: "auto",
          background: theme.bg.elevated,
          border: `1px solid ${theme.border.strong}`,
          borderRadius: theme.radius.sm,
          padding: `2px ${theme.space[1]}px`,
          fontSize: theme.size.xs,
          color: theme.text.muted,
        }}>N</span>
      </button>
    );
  }

  // ── Bloomed form ──
  return (
    <div style={{
      background: theme.bg.surface,
      border: `1px solid ${theme.blue}`,
      borderRadius: theme.radius.md,
      padding: theme.space[4],
      marginBottom: theme.space[4],
    }}>

      {/* Entry type selector */}
      <div style={{ display: "flex", gap: theme.space[1], marginBottom: theme.space[4] }}>
        {JOURNAL_ENTRY_TYPES.map(({ key, label, activeColor, activeBg }) => {
          const active  = entryType === key;
          const hovered = hoveredType === key;
          return (
            <button
              key={key}
              onClick={() => { resetForm(); setEntryType(key); }}
              onMouseEnter={() => setHoveredType(key)}
              onMouseLeave={() => setHoveredType(null)}
              style={{
                flex: 1, padding: `${theme.space[2]}px 0`, fontSize: theme.size.sm, fontFamily: "inherit",
                cursor: "pointer", borderRadius: theme.radius.sm,
                fontWeight: active ? 600 : 400,
                background: active ? activeBg : hovered ? "rgba(58,130,246,0.06)" : "transparent",
                color: active ? activeColor : theme.text.muted,
                border: `1px solid ${active ? activeColor : theme.border.strong}`,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Trade Note fields ── */}
      {entryType === "trade_note" && (
        <>
          {posSelectEl("Link to open position (optional)", true)}
          <JournalField label="Link to closed trade (optional)">
            <select
              style={JOURNAL_INPUT_ST}
              value={tradeSelectIdx >= 0 ? tradeSelectIdx : ""}
              onChange={e => handleLinkTrade(e.target.value !== "" ? closedTradeOptions[+e.target.value] : null)}
            >
              <option value="">— none —</option>
              {closedTradeOptions.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
            </select>
          </JournalField>
          <JournalField label="Title">
            <input
              type="text" style={JOURNAL_INPUT_ST} value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              placeholder="Auto-filled from linked trade, or enter manually"
            />
          </JournalField>
          <JournalField label="Source">
            <div style={{ display: "flex", gap: theme.space[4], fontSize: theme.size.sm }}>
              {["Ryan", "Self"].map(s => (
                <label key={s} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: theme.text.secondary }}>
                  <input type="radio" name="journal-source" value={s} checked={formSource === s} onChange={() => setFormSource(s)} style={{ accentColor: theme.blue }} />
                  {s}
                </label>
              ))}
            </div>
          </JournalField>
          <JournalField label="Tags">
            <TagInput value={formTags} onChange={setFormTags} vocabulary={vocabulary} />
          </JournalField>
          <JournalField label="Notes">
            <JournalAutoTextarea value={formBody} onChange={e => setFormBody(e.target.value)} minH={120} placeholder="Trade rationale, setup details..." />
          </JournalField>
        </>
      )}

      {/* ── EOD Update fields ── */}
      {entryType === "eod_update" && (
        <>
          <JournalField label="Date">
            <input type="date" style={JOURNAL_INPUT_ST} value={formDate} onChange={e => setFormDate(e.target.value)} />
          </JournalField>
          <JournalField label="Mood">
            <div style={{ display: "flex", gap: theme.space[1] }}>
              {MOODS.map(m => {
                const active  = formMood === m.emoji;
                const hovered = hoveredMood === m.emoji;
                return (
                  <button
                    key={m.emoji}
                    onClick={() => setFormMood(m.emoji)}
                    onMouseEnter={() => setHoveredMood(m.emoji)}
                    onMouseLeave={() => setHoveredMood(null)}
                    style={{
                      flex: 1, padding: `${theme.space[2]}px 2px`, borderRadius: theme.radius.sm, cursor: "pointer",
                      border: `2px solid ${active ? m.activeBorder : theme.border.strong}`,
                      background: active ? m.activeBg : hovered ? "rgba(58,130,246,0.06)" : "transparent",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: theme.space[1],
                      fontFamily: "inherit",
                    }}
                  >
                    <span style={{ fontSize: theme.size.xl, lineHeight: 1 }}>{m.emoji}</span>
                    <span style={{ fontSize: theme.size.xs, color: active ? m.activeBorder : theme.text.subtle }}>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </JournalField>

          {/* Snapshot values — auto-populated from synced account data, read-only */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.space[2], marginBottom: theme.space[3] }}>
            {[
              { label: "Free Cash %", value: eodAutoFreeCash != null ? `${eodAutoFreeCash}%` : "—" },
              { label: "VIX",         value: eodAutoVix      != null ? eodAutoVix            : "—" },
              { label: "Pipeline $",  value: eodAutoPipeline  > 0    ? `$${eodAutoPipeline.toLocaleString()}` : "—" },
            ].map(({ label, value }) => (
              <div key={label}>
                <label style={JOURNAL_LABEL_ST}>{label}</label>
                <div style={{ ...JOURNAL_INPUT_ST, color: theme.text.primary, fontWeight: 500 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Auto-populated preview panel */}
          <div style={{ background: theme.bg.base, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm, padding: `${theme.space[2]}px ${theme.space[3]}px`, marginBottom: theme.space[3], fontSize: theme.size.sm }}>
            <div style={{ color: theme.text.subtle, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8, fontSize: theme.size.xs }}>
              Preview (auto-populated)
            </div>

            {/* Deployment status */}
            {eodDeploymentPreview ? (
              <div style={{ marginBottom: theme.space[1] }}>
                <span style={{ color: theme.text.muted }}>Deployment: </span>
                <span style={{
                  color: eodDeploymentPreview.status === "above" ? theme.amber
                       : eodDeploymentPreview.status === "below" ? theme.red
                       : theme.green,
                }}>
                  {eodDeploymentPreview.status === "above"
                    ? `↑ ${(eodDeploymentPreview.delta * 100).toFixed(1)}% above ceiling`
                    : eodDeploymentPreview.status === "below"
                    ? `↓ ${(eodDeploymentPreview.delta * 100).toFixed(1)}% below floor`
                    : "✓ in band"}
                </span>
                <span style={{ color: theme.text.subtle }}> · Floor: {eodDeploymentPreview.band.floorPct * 100}–{eodDeploymentPreview.band.ceilingPct * 100}%</span>
              </div>
            ) : (
              <div style={{ color: theme.text.subtle, marginBottom: theme.space[1] }}>Deployment: — (enter VIX + Free Cash)</div>
            )}

            {/* MTD Realized */}
            <div style={{ marginBottom: theme.space[1] }}>
              <span style={{ color: theme.text.muted }}>MTD Realized: </span>
              <span style={{ color: theme.text.secondary }}>
                {account?.month_to_date_premium != null
                  ? `$${account.month_to_date_premium.toLocaleString()}`
                  : "—"}
              </span>
            </div>

            {/* Pipeline Est (60%) */}
            {eodAutoPipeline > 0 && (
              <div style={{ marginBottom: theme.space[1] }}>
                <span style={{ color: theme.text.muted }}>Pipeline Est. (60%): </span>
                <span style={{ color: theme.text.secondary }}>${Math.round(eodAutoPipeline * 0.60).toLocaleString()}</span>
              </div>
            )}

            {/* Today's activity */}
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: theme.text.muted }}>Today's activity: </span>
              {eodClosedToday.length === 0 && eodOpenedToday.length === 0
                ? <span style={{ color: theme.text.subtle }}>No trades on {formDate}</span>
                : null}
            </div>
            {eodClosedToday.map((t, i) => (
              <div key={i} style={{ color: theme.text.subtle, paddingLeft: 8, marginBottom: 2 }}>
                Closed {t.ticker} {t.type} ${t.strike}
                {t.pct_kept != null && <span> · {t.pct_kept}%</span>}
                {t.dte_remaining != null && <span> · {t.dte_remaining}d DTE rem.</span>}
              </div>
            ))}
            {eodOpenedToday.map((p, i) => (
              <div key={i} style={{ color: theme.text.subtle, paddingLeft: 8, marginBottom: 2 }}>
                Opened {p.ticker} {p.type} ${p.strike} · exp {formatExpiry(p.expiry)}
                {p.premium && <span> · ${p.premium.toLocaleString()}</span>}
              </div>
            ))}

            {/* Open CSPs count */}
            <div style={{ marginTop: 4, color: theme.text.muted }}>
              Open CSPs: <span style={{ color: theme.text.secondary }}>{eodOpenCsps.length} position{eodOpenCsps.length !== 1 ? "s" : ""}</span>
            </div>
          </div>

          <JournalField label="Notes">
            <JournalAutoTextarea value={formBody} onChange={e => setFormBody(e.target.value)} minH={200} placeholder="What happened today, macro context, anything worth noting for the monthly review..." />
          </JournalField>
        </>
      )}

      {/* ── Position Note fields ── */}
      {entryType === "position_note" && (
        <>
          {posSelectEl("Position", false)}
          <JournalField label="Title">
            <input
              type="text" style={JOURNAL_INPUT_ST} value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              placeholder="Auto-filled from position, or enter manually"
            />
          </JournalField>
          <JournalField label="Notes">
            <JournalAutoTextarea value={formBody} onChange={e => setFormBody(e.target.value)} minH={120} placeholder="Ongoing observations, roll considerations, delta watch..." />
          </JournalField>
        </>
      )}

      {/* Save error */}
      {saveError && (
        <div style={{ color: theme.red, fontSize: theme.size.sm, marginBottom: theme.space[2], padding: `${theme.space[2]}px ${theme.space[2]}px`, background: theme.bg.base, borderRadius: theme.radius.sm }}>
          {saveError}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: theme.space[2], justifyContent: "flex-end" }}>
        <button
          onClick={() => { resetForm(); onClose(); }}
          onMouseEnter={() => setCancelHovered(true)}
          onMouseLeave={() => setCancelHovered(false)}
          style={{ background: cancelHovered ? "rgba(58,130,246,0.06)" : "transparent", border: "none", color: theme.text.muted, cursor: "pointer", fontSize: theme.size.md, fontFamily: "inherit", padding: `${theme.space[1]}px ${theme.space[3]}px`, borderRadius: theme.radius.sm }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            background: theme.green, border: "none", color: theme.text.primary,
            cursor: saving ? "not-allowed" : "pointer",
            fontSize: theme.size.md, fontFamily: "inherit", padding: `${theme.space[1]}px ${theme.space[4]}px`,
            borderRadius: theme.radius.sm, fontWeight: 500, opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Saving..." : entryType === "eod_update" ? "Save Update" : "Save Note"}
        </button>
      </div>

    </div>
  );
}
