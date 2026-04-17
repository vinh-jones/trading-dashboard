import { useState, useMemo, useEffect } from "react";
import { useData } from "../../hooks/useData";
import { useLiveVix } from "../../hooks/useLiveVix";
import { useQuotes } from "../../hooks/useQuotes";
import { generateFocusItems } from "../../lib/focusEngine";
import { formatDollars, formatExpiry } from "../../lib/format";
import { calcDTE, computeEodMetadata } from "../../lib/trading";
import { getVixBand } from "../../lib/vixBand";
import { TYPE_COLORS, SUBTYPE_LABELS } from "../../lib/constants";
import { supabase } from "../../lib/supabase";
import { JOURNAL_BADGE, MOODS, JOURNAL_ENTRY_TYPES, JOURNAL_INPUT_ST, JOURNAL_LABEL_ST } from "./journalConstants";
import { todayISO, journalSinceDate, fmtEntryDate, buildAutoTitle } from "./journalHelpers";
import { JournalEntryCard } from "./JournalEntryCard";
import { JournalInlineEditForm } from "./JournalInlineEditForm";
import { JournalField } from "./JournalField";
import { JournalAutoTextarea } from "./JournalAutoTextarea";
import { theme } from "../../lib/theme";

export function JournalTab() {
  const { trades, positions, account } = useData();

  // Feed
  const [entries,   setEntries]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [feedError, setFeedError] = useState(null);

  // Filters
  const [filterType,   setFilterType]   = useState("all");
  const [filterTicker, setFilterTicker] = useState("all");
  const [filterSince,  setFilterSince]  = useState("this_month");

  // Form
  const [entryType,      setEntryType]      = useState("trade_note");
  const [linkedPosition, setLinkedPosition] = useState(null);

  // Inline edit state (replaces right-panel edit mode)
  const [inlineEditId,  setInlineEditId]  = useState(null);
  const [inlineTitle,   setInlineTitle]   = useState("");
  const [inlineBody,    setInlineBody]    = useState("");
  const [inlineTags,    setInlineTags]    = useState("");
  const [inlineSource,  setInlineSource]  = useState("Self");
  const [inlineMood,    setInlineMood]    = useState("🟡");
  const [inlineSaving,     setInlineSaving]     = useState(false);
  const [inlineError,      setInlineError]      = useState(null);
  const [linkedTrade,    setLinkedTrade]    = useState(null);
  const [formTitle,      setFormTitle]      = useState("");
  const [formSource,     setFormSource]     = useState("Self");
  const [formTags,       setFormTags]       = useState("");
  const [formDate,       setFormDate]       = useState(todayISO());
  const [formBody,       setFormBody]       = useState("");
  const [saveError,      setSaveError]      = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [formMood,       setFormMood]       = useState("🟡");

  // Tickers seen in the feed (for filter dropdown)
  const feedTickers = useMemo(
    () => [...new Set(entries.map(e => e.ticker).filter(Boolean))].sort(),
    [entries]
  );

  // All open positions flattened into selectable options
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

  // Closed trades sorted newest-first for the trade link dropdown
  const closedTradeOptions = useMemo(() =>
    [...trades]
      .sort((a, b) => (b.closeDate ?? 0) - (a.closeDate ?? 0))
      .map(t => ({
        label: `${t.ticker} ${t.type}${t.strike ? ` $${t.strike}` : ""} — ${t.close} (${t.kept})`,
        ticker: t.ticker, obj: t,
      })),
  [trades]);

  // ── EOD auto-populated values — derived from account + positions, no form input needed ──

  // Free Cash % as a display percentage (e.g. 15.4)
  const eodAutoFreeCash = useMemo(() =>
    account?.free_cash_pct_est != null ? +(account.free_cash_pct_est * 100).toFixed(1) : null,
  [account]);

  // VIX — live from /api/vix (same source as PersistentHeader), falls back to last-synced snapshot value
  const { vix: eodAutoVix } = useLiveVix(account?.vix_current ?? null);
  const { quoteMap } = useQuotes();

  // Gross open pipeline = sum of premium from all open CSPs + active CCs
  const eodAutoPipeline = useMemo(() => {
    const csps = (positions.open_csps || []).reduce((sum, p) => sum + (p.premium_collected || 0), 0);
    const ccs  = (positions.assigned_shares || []).reduce((sum, s) => sum + (s.active_cc?.premium_collected || 0), 0);
    return csps + ccs;
  }, [positions]);

  // ── EOD preview data — derived from existing app state, no extra API call ──

  // Today's closed CSP trades (for EOD form preview + metadata snapshot)
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

  // Today's opened CSP positions
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

  // Current open CSPs with computed DTE metrics (for EOD form preview + metadata snapshot)
  const eodOpenCsps = useMemo(() => {
    const refDate = formDate || todayISO();
    return (positions.open_csps || [])
      .filter(p => p.type === "CSP")
      .map(p => {
        const expiryMs   = new Date(p.expiry_date + "T12:00:00").getTime();
        const refMs      = new Date(refDate       + "T12:00:00").getTime();
        const openMs     = new Date(p.open_date   + "T12:00:00").getTime();
        const dte        = Math.max(0, Math.ceil((expiryMs - refMs)    / 86400000));
        const totalDays  = Math.max(1, Math.ceil((expiryMs - openMs)   / 86400000));
        const dte_pct    = Math.round(dte / totalDays * 100);
        const roi        = p.capital_fronted > 0
          ? +(p.premium_collected / p.capital_fronted * 100).toFixed(2)
          : 0;
        return {
          ticker:   p.ticker,
          strike:   p.strike,
          expiry:   p.expiry_date,
          dte,
          dte_pct,
          premium:  p.premium_collected,
          capital:  p.capital_fronted,
          roi,
        };
      });
  }, [positions, formDate]);

  // Live deployment status preview from auto-computed account values
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

  useEffect(() => { fetchEntries(); }, [filterType, filterTicker, filterSince]);

  async function fetchEntries() {
    setLoading(true);
    setFeedError(null);
    try {
      let query = supabase
        .from("journal_entries")
        .select("*")
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);
      if (filterType !== "all")   query = query.eq("entry_type", filterType);
      if (filterTicker !== "all") query = query.eq("ticker", filterTicker);
      const sd = journalSinceDate(filterSince);
      if (sd) query = query.gte("entry_date", sd);
      const { data, error } = await query;
      if (error) throw error;
      setEntries(data ?? []);
    } catch (err) {
      setFeedError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setFormTitle(""); setFormBody(""); setFormTags(""); setFormSource("Self");
    setLinkedPosition(null); setLinkedTrade(null);
    setFormDate(todayISO());
    setFormMood("🟡");
    setSaveError(null);
  }

  function handleEdit(entry) {
    setInlineEditId(entry.id);
    setInlineTitle(entry.title ?? "");
    setInlineBody(entry.body ?? "");
    setInlineTags((entry.tags || []).join(", "));
    setInlineSource(entry.source ?? "Self");
    setInlineMood(entry.mood ?? "🟡");
    setInlineError(null);
  }

  function handleInlineCancel() {
    setInlineEditId(null);
    setInlineError(null);
  }

  async function handleInlineSave(entryType, existingEntry) {
    const isEOD = entryType === "eod_update";
    const titleToSave = isEOD ? inlineTitle : inlineTitle.trim();
    if (!isEOD && !titleToSave) { setInlineError("Title is required."); return; }
    if (!inlineBody.trim())     { setInlineError("Notes are required."); return; }
    setInlineSaving(true);
    setInlineError(null);
    try {
      const tags = [...new Set(
        inlineTags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean)
      )];
      const src  = isEOD ? null : (inlineSource || null);
      const mood = isEOD ? inlineMood : null;
      const now  = new Date().toISOString();

      // For EOD entries, rebuild metadata preserving stored activity + csp_snapshot snapshots.
      const metadata = isEOD ? computeEodMetadata({
        freeCashPct:   eodAutoFreeCash,
        vix:           eodAutoVix,
        pipelineTotal: eodAutoPipeline,
        mtdRealized:   existingEntry?.metadata?.mtd_realized ?? null,
        activity:      existingEntry?.metadata?.activity     ?? { closed: [], opened: [] },
        cspSnapshot:   existingEntry?.metadata?.csp_snapshot ?? [],
      }) : undefined;

      const updateFields = { title: titleToSave, body: inlineBody.trim(), tags, source: src, mood, updated_at: now };
      if (isEOD) updateFields.metadata = metadata;

      const { error } = await supabase
        .from("journal_entries")
        .update(updateFields)
        .eq("id", inlineEditId);
      if (error) throw error;
      setEntries(prev => prev.map(e =>
        e.id === inlineEditId
          ? { ...e, title: titleToSave, body: inlineBody.trim(), tags, source: src, mood, ...(isEOD ? { metadata } : {}) }
          : e
      ));
      setInlineEditId(null);
    } catch (err) {
      setInlineError(err.message);
    } finally {
      setInlineSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this entry? This cannot be undone.")) return;
    const { error } = await supabase.from("journal_entries").delete().eq("id", id);
    if (error) { window.alert(`Delete failed: ${error.message}`); return; }
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  async function handleSave() {
    const isEOD = entryType === "eod_update";
    const titleToSave = isEOD ? `EOD — ${formDate}` : formTitle.trim();
    if (!isEOD && !titleToSave) { setSaveError("Title is required."); return; }
    if (!formBody.trim())       { setSaveError("Notes are required."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const tags = [...new Set(
        formTags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean)
      )];
      const ticker = linkedPosition?.ticker ?? linkedTrade?.ticker ?? null;
      const now    = new Date().toISOString();
      const src    = isEOD ? null : (formSource || null);

      const mood = isEOD ? formMood : null;

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
      setEntries(prev => [data, ...prev]);
      resetForm();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
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

  // Current select indices for position/trade dropdowns
  const posSelectIdx  = linkedPosition ? positionOptions.findIndex(o => o.obj === linkedPosition) : -1;
  const tradeSelectIdx = linkedTrade   ? closedTradeOptions.findIndex(o => o.obj === linkedTrade) : -1;

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

  const filterSelectSt = {
    background: theme.bg.base, border: `1px solid ${theme.border.default}`, color: theme.text.secondary,
    borderRadius: theme.radius.sm, padding: "4px 8px", fontFamily: "inherit", fontSize: theme.size.sm,
  };

  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>

      {/* ── LEFT: Activity Feed ──────────────────────────────────────────── */}
      <div style={{ flex: "1 1 420px", minWidth: 0 }}>

        {/* Filter bar */}
        <div style={{
          display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
          padding: "10px 12px", background: theme.bg.surface, borderRadius: theme.radius.md,
          border: `1px solid ${theme.border.default}`, marginBottom: 16,
        }}>
          <span style={{ color: theme.text.subtle, fontSize: 12, marginRight: 4 }}>Filter:</span>
          <select style={filterSelectSt} value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">All types</option>
            <option value="trade_note">Trade Notes</option>
            <option value="eod_update">EOD Updates</option>
            <option value="position_note">Position Notes</option>
          </select>
          <select style={filterSelectSt} value={filterTicker} onChange={e => setFilterTicker(e.target.value)}>
            <option value="all">All tickers</option>
            {feedTickers.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select style={filterSelectSt} value={filterSince} onChange={e => setFilterSince(e.target.value)}>
            <option value="this_month">This month</option>
            <option value="last_30">Last 30 days</option>
            <option value="last_90">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </div>

        {/* Feed content */}
        {loading && (
          <div style={{ color: theme.text.muted, fontSize: 13, padding: "20px 0" }}>Loading...</div>
        )}
        {feedError && (
          <div style={{ color: theme.red, fontSize: 13, padding: "10px 12px", background: theme.bg.base, borderRadius: theme.radius.sm, marginBottom: 12 }}>
            Error loading feed: {feedError}
          </div>
        )}
        {!loading && !feedError && entries.length === 0 && (
          <div style={{ color: theme.text.muted, fontSize: 13, padding: "40px 0", textAlign: "center", lineHeight: 1.9 }}>
            No journal entries yet.<br />
            Use the form to add your first trade note or EOD update.
          </div>
        )}
        {!loading && entries.map(entry =>
          entry.id === inlineEditId
            ? <JournalInlineEditForm
                key={entry.id}
                entry={entry}
                title={inlineTitle}           onTitleChange={e => setInlineTitle(e.target.value)}
                body={inlineBody}             onBodyChange={e => setInlineBody(e.target.value)}
                tags={inlineTags}             onTagsChange={e => setInlineTags(e.target.value)}
                source={inlineSource}         onSourceChange={setInlineSource}
                mood={inlineMood}             onMoodChange={setInlineMood}
                onSave={() => handleInlineSave(entry.entry_type, entry)}
                onCancel={handleInlineCancel}
                saving={inlineSaving}
                error={inlineError}
              />
            : <JournalEntryCard key={entry.id} entry={entry} onEdit={handleEdit} onDelete={handleDelete} />
        )}
      </div>

      {/* ── RIGHT: New Entry Form ────────────────────────────────────────── */}
      <div style={{ flex: "0 0 340px", minWidth: 300 }}>
        <div style={{ background: theme.bg.surface, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md, padding: 16 }}>

          {/* Form header */}
          <div style={{ marginBottom: 14, fontSize: theme.size.md, fontWeight: 600, color: theme.text.primary }}>
            New Entry
          </div>

          {/* Entry type selector */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {JOURNAL_ENTRY_TYPES.map(({ key, label, activeColor, activeBg }) => {
              const active = entryType === key;
              return (
                <button
                  key={key}
                  onClick={() => { resetForm(); setEntryType(key); }}
                  style={{
                    flex: 1, padding: "7px 0", fontSize: 12, fontFamily: "inherit",
                    cursor: "pointer", borderRadius: 4,
                    fontWeight: active ? 600 : 400,
                    background: active ? activeBg : "transparent",
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
              {(
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
              )}
              <JournalField label="Title">
                <input
                  type="text" style={JOURNAL_INPUT_ST} value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="Auto-filled from linked trade, or enter manually"
                />
              </JournalField>
              <JournalField label="Source">
                <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                  {["Ryan", "Self"].map(s => (
                    <label key={s} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: theme.text.secondary }}>
                      <input type="radio" name="journal-source" value={s} checked={formSource === s} onChange={() => setFormSource(s)} style={{ accentColor: theme.blue }} />
                      {s}
                    </label>
                  ))}
                </div>
              </JournalField>
              <JournalField label="Tags (comma separated, optional)">
                <input
                  type="text" style={JOURNAL_INPUT_ST} value={formTags}
                  onChange={e => setFormTags(e.target.value)}
                  placeholder="ryan-signal, lower-bb, vix-elevated"
                />
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
                <div style={{ display: "flex", gap: 6 }}>
                  {MOODS.map(m => {
                    const active = formMood === m.emoji;
                    return (
                      <button
                        key={m.emoji}
                        onClick={() => setFormMood(m.emoji)}
                        style={{
                          flex: 1, padding: "8px 2px", borderRadius: theme.radius.sm, cursor: "pointer",
                          border: `2px solid ${active ? m.activeBorder : theme.border.strong}`,
                          background: active ? m.activeBg : "transparent",
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                          fontFamily: "inherit",
                        }}
                      >
                        <span style={{ fontSize: 20, lineHeight: 1 }}>{m.emoji}</span>
                        <span style={{ fontSize: theme.size.xs, color: active ? m.activeBorder : theme.text.subtle }}>{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              </JournalField>

              {/* Snapshot values — auto-populated from synced account data, read-only */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                {[
                  { label: "Free Cash %", value: eodAutoFreeCash != null ? `${eodAutoFreeCash}%` : "—" },
                  { label: "VIX",         value: eodAutoVix      != null ? eodAutoVix            : "—" },
                  { label: "Pipeline $",  value: eodAutoPipeline  > 0    ? `$${eodAutoPipeline.toLocaleString()}` : "—" },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <label style={JOURNAL_LABEL_ST}>{label}</label>
                    <div style={{ ...JOURNAL_INPUT_ST, color: theme.text.primary, fontWeight: 500 }}>{value}</div>
                  </div>
                ))}</div>

              {/* Auto-populated preview panel */}
              <div style={{ background: theme.bg.base, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm, padding: "10px 12px", marginBottom: 14, fontSize: 12 }}>
                <div style={{ color: theme.text.subtle, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8, fontSize: theme.size.xs }}>
                  Preview (auto-populated)
                </div>

                {/* Deployment status */}
                {eodDeploymentPreview ? (
                  <div style={{ marginBottom: 6 }}>
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
                  <div style={{ color: theme.text.subtle, marginBottom: 6 }}>Deployment: — (enter VIX + Free Cash)</div>
                )}

                {/* MTD Realized */}
                <div style={{ marginBottom: 6 }}>
                  <span style={{ color: theme.text.muted }}>MTD Realized: </span>
                  <span style={{ color: theme.text.secondary }}>
                    {account?.month_to_date_premium != null
                      ? `$${account.month_to_date_premium.toLocaleString()}`
                      : "—"}
                  </span>
                </div>

                {/* Pipeline Est (60%) */}
                {eodAutoPipeline > 0 && (
                  <div style={{ marginBottom: 6 }}>
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
            <div style={{ color: theme.red, fontSize: 12, marginBottom: 10, padding: "8px 10px", background: theme.bg.base, borderRadius: theme.radius.sm }}>
              {saveError}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={resetForm}
              style={{ background: "transparent", border: "none", color: theme.text.muted, cursor: "pointer", fontSize: theme.size.md, fontFamily: "inherit", padding: "6px 12px" }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                background: theme.green, border: "none", color: theme.text.primary,
                cursor: saving ? "not-allowed" : "pointer",
                fontSize: theme.size.md, fontFamily: "inherit", padding: "6px 16px",
                borderRadius: theme.radius.sm, fontWeight: 500, opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving..." : entryType === "eod_update" ? "Save Update" : "Save Note"}
            </button>
          </div>

        </div>
      </div>

    </div>
  );
}
