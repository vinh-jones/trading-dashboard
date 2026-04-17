import { useState, useMemo, useEffect } from "react";
import { useData } from "../../hooks/useData";
import { formatExpiry } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import { JOURNAL_BADGE } from "./journalConstants";
import { journalSinceDate, fmtEntryDate } from "./journalHelpers";
import { JournalEntryCard } from "./JournalEntryCard";
import { EODBand } from "./EODBand";
import { JournalInlineEditForm } from "./JournalInlineEditForm";
import { JournalQuickAdd } from "./JournalQuickAdd";
import { computeEodMetadata } from "../../lib/trading";
import { useLiveVix } from "../../hooks/useLiveVix";
import { theme } from "../../lib/theme";
import { groupByWeek, weekLabel } from "../../lib/journalGrouping";
import { WeekRail } from "./WeekRail";
import { useWindowWidth } from "../../hooks/useWindowWidth";

const MONTH_ABBR_LABEL = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function rangeLabel(weekStartISO, weekEndISO) {
  const s = new Date(weekStartISO + "T00:00:00");
  const e = new Date(weekEndISO + "T00:00:00");
  const sameMonth = s.getMonth() === e.getMonth();
  const sMonth = MONTH_ABBR_LABEL[s.getMonth()];
  const eMonth = MONTH_ABBR_LABEL[e.getMonth()];
  if (sameMonth) return `${sMonth} ${s.getDate()} – ${e.getDate()}`;
  return `${sMonth} ${s.getDate()} – ${eMonth} ${e.getDate()}`;
}

export function JournalTab({ journalIntent, onJournalIntentConsumed }) {
  const { trades, positions, account } = useData();

  // Feed
  const [entries,   setEntries]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [feedError, setFeedError] = useState(null);

  // Filters
  const [filterType,   setFilterType]   = useState("all");
  const [filterTicker, setFilterTicker] = useState("all");
  const [filterSince,  setFilterSince]  = useState("this_month");

  // Quick-add bloom state
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // Inline edit state
  const [inlineEditId,  setInlineEditId]  = useState(null);
  const [inlineTitle,   setInlineTitle]   = useState("");
  const [inlineBody,    setInlineBody]    = useState("");
  const [inlineTags,    setInlineTags]    = useState("");
  const [inlineSource,  setInlineSource]  = useState("Self");
  const [inlineMood,    setInlineMood]    = useState("🟡");
  const [inlineSaving,  setInlineSaving]  = useState(false);
  const [inlineError,   setInlineError]   = useState(null);

  // Q5: focus states for filter selects
  const [focusedFilter, setFocusedFilter] = useState(null);

  const isMobile = useWindowWidth() < 600;

  // Tickers seen in the feed (for filter dropdown)
  const feedTickers = useMemo(
    () => [...new Set(entries.map(e => e.ticker).filter(Boolean))].sort(),
    [entries]
  );

  // EOD auto values needed for inline edit save
  const eodAutoFreeCash = useMemo(() =>
    account?.free_cash_pct_est != null ? +(account.free_cash_pct_est * 100).toFixed(1) : null,
  [account]);
  const { vix: eodAutoVix } = useLiveVix(account?.vix_current ?? null);
  const eodAutoPipeline = useMemo(() => {
    const csps = (positions.open_csps || []).reduce((sum, p) => sum + (p.premium_collected || 0), 0);
    const ccs  = (positions.assigned_shares || []).reduce((sum, s) => sum + (s.active_cc?.premium_collected || 0), 0);
    return csps + ccs;
  }, [positions]);

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

  const filterSelectSt = (id) => ({
    background: theme.bg.base, border: `1px solid ${focusedFilter === id ? theme.blue : theme.border.default}`, color: theme.text.secondary,
    borderRadius: theme.radius.sm, padding: "4px 8px", fontFamily: "inherit", fontSize: theme.size.sm,
    outline: "none",
  });

  return (
    <div style={{ width: "100%", minWidth: 0 }}>

      <JournalQuickAdd
        isOpen={quickAddOpen}
        onOpen={() => setQuickAddOpen(true)}
        onClose={() => setQuickAddOpen(false)}
        trades={trades}
        positions={positions}
        account={account}
        journalIntent={journalIntent}
        onJournalIntentConsumed={onJournalIntentConsumed}
        onEntryCreated={fetchEntries}
      />

      {/* Filter bar */}
      <div style={{
        display: "flex", gap: theme.space[2], flexWrap: "wrap", alignItems: "center",
        padding: `${theme.space[2]}px ${theme.space[3]}px`, background: theme.bg.surface, borderRadius: theme.radius.md,
        border: `1px solid ${theme.border.default}`, marginBottom: theme.space[4],
      }}>
        <span style={{ color: theme.text.subtle, fontSize: theme.size.sm, marginRight: theme.space[1] }}>Filter:</span>
        <select style={filterSelectSt("type")} value={filterType}
          onFocus={() => setFocusedFilter("type")} onBlur={() => setFocusedFilter(null)}
          onChange={e => setFilterType(e.target.value)}>
          <option value="all">All types</option>
          <option value="trade_note">Trade Notes</option>
          <option value="eod_update">EOD Updates</option>
          <option value="position_note">Position Notes</option>
        </select>
        <select style={filterSelectSt("ticker")} value={filterTicker}
          onFocus={() => setFocusedFilter("ticker")} onBlur={() => setFocusedFilter(null)}
          onChange={e => setFilterTicker(e.target.value)}>
          <option value="all">All tickers</option>
          {feedTickers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select style={filterSelectSt("since")} value={filterSince}
          onFocus={() => setFocusedFilter("since")} onBlur={() => setFocusedFilter(null)}
          onChange={e => setFilterSince(e.target.value)}>
          <option value="this_month">This month</option>
          <option value="last_30">Last 30 days</option>
          <option value="last_90">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      {/* Feed content */}
      {loading && (
        <div style={{ color: theme.text.muted, fontSize: theme.size.sm, padding: "20px 0" }}>Loading...</div>
      )}
      {feedError && (
        <div style={{ color: theme.red, fontSize: theme.size.sm, padding: `${theme.space[2]}px ${theme.space[3]}px`, background: theme.bg.base, borderRadius: theme.radius.sm, marginBottom: theme.space[3] }}>
          Error loading feed: {feedError}
        </div>
      )}
      {!loading && !feedError && entries.length === 0 && (
        <div style={{ color: theme.text.muted, fontSize: theme.size.sm, padding: "40px 0", textAlign: "center", lineHeight: 1.9 }}>
          No journal entries yet.<br />
          Use the form above to add your first trade note or EOD update.
        </div>
      )}
      {!loading && entries.length > 0 && (() => {
        const weeks = groupByWeek(entries);
        const now = new Date();
        const todayISOStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;

        return weeks.map(week => {
          const totalEntries = week.days.reduce((sum, d) => sum + d.entries.length, 0);
          return (
            <div key={week.weekStart} style={{
              display: "flex",
              flexDirection: isMobile ? "column" : "row",
              gap: isMobile ? theme.space[2] : theme.space[4],
              marginBottom: theme.space[5],
              alignItems: "flex-start",
            }}>
              <WeekRail
                label={weekLabel(week.weekStart, todayISOStr)}
                rangeLabel={rangeLabel(week.weekStart, week.weekEnd)}
                entryCount={totalEntries}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                {week.days.map(day => (
                  <div key={day.date} style={{ marginBottom: theme.space[3] }}>
                    <div style={{
                      fontSize: theme.size.sm, color: theme.text.subtle,
                      textTransform: "uppercase", letterSpacing: "0.5px",
                      marginBottom: theme.space[2],
                    }}>
                      {new Date(day.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "long" })}
                    </div>
                    {(() => {
                      const eodEntries   = day.entries.filter(e => e.entry_type === "eod_update");
                      const otherEntries = day.entries.filter(e => e.entry_type !== "eod_update");

                      const renderCard = (entry) =>
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
                          : entry.entry_type === "eod_update"
                            ? <EODBand key={entry.id} entry={entry} onEdit={handleEdit} onDelete={handleDelete} />
                            : <JournalEntryCard key={entry.id} entry={entry} onEdit={handleEdit} onDelete={handleDelete} />;

                      return [...eodEntries.map(renderCard), ...otherEntries.map(renderCard)];
                    })()}
                  </div>
                ))}
              </div>
            </div>
          );
        });
      })()}

    </div>
  );
}
