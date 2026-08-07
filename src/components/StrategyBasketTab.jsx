import { Fragment, useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { useQuotes } from "../hooks/useQuotes";
import { theme } from "../lib/theme";
import { TYPE_COLORS } from "../lib/constants";
import { getOpenCSPs, getOpenCCs, getOpenLEAPs, getOpenSpreads } from "../lib/positionSchema";
import {
  resolveBasket, basketTarget, capitalDeployed,
  realizedRecovery, unrealizedCushion, memberUnrealized, holdCounterfactual,
  shareCoverageWarnings, tupleMatch, groupMembersByType,
} from "../lib/strategyBasket";
import { createJournalEntry } from "../lib/journalApi";

const STRATEGY_PREFIX = "strategy:";

// Most-recent-N closed trades offered in the attribution picker. The overflow is
// disclosed in the form's hint line rather than silently dropped.
const ATTR_TRADE_CAP = 40;

// Coerce-then-check, rather than Number.isFinite(n) on the raw argument.
//
// No caller can hand this a string today, and none can hand it a NaN either:
// every dollar value it renders traces back to `premium_collected` or
// `capital_fronted`, both `integer` columns, and PostgREST serializes integers
// as JSON numbers (it is `numeric` that comes over as a string). So the coercion
// is not load-bearing — do not read this comment as documenting a live hazard.
//
// It stays because this is the display boundary and a total function here costs
// nothing. The sibling money-ish columns `strike`, `entry_cost`, `exit_cost`,
// `roi` and `kept_pct` ARE `numeric` and do arrive as strings ("157.5"), so a
// future caller passing entryCost or strike is entirely plausible, and
// Number.isFinite is strictly stronger than a null check at zero cost. Anything
// not finite after coercion — null, undefined, "abc", NaN, Infinity — renders
// as an em dash instead of "$NaN".
function fmtMoney(n) {
  const v = Number(n);
  if (n == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  // Fractional attributions land on half dollars; show cents only when they exist.
  const isWhole = Math.abs(abs - Math.round(abs)) < 0.005;
  const body = isWhole
    ? Math.round(abs).toLocaleString()
    : abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}$${body}`;
}

// Attributed counts can be fractional after scaling (25 of a 100-share lot);
// show a decimal only when there is one. 4 → "4", 4.5 → "4.5".
// Same coerce-then-check guard as fmtMoney, and for the same reason: no caller
// hands this a string today either (`contracts` is an `integer` column, so it
// arrives as a JSON number), but a total function at a display boundary is free.
function fmtCount(n) {
  const v = Number(n);
  if (n == null || !Number.isFinite(v)) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ISO "YYYY-MM-DD" → "MM/DD/YY". Passes through anything non-ISO unchanged.
function fmtDate(d) {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : String(d);
}

// Premium-kept fraction → whole percent: 0.5 → "50%", 0.5582 → "56%".
function fmtKept(frac) {
  if (frac == null || Number.isNaN(frac)) return "—";
  return `${Math.round(frac * 100)}%`;
}

// Whole days from an ISO date to today (browser-local). Null/invalid → null.
function daysSince(iso) {
  if (!iso) return null;
  const t = Date.parse(`${iso}T12:00:00`);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

// Shared column geometry for the transaction table (header + rows stay aligned).
const COL = {
  date:   { width: 64, flexShrink: 0 },
  ticker: { width: 52, flexShrink: 0 },
  type:   { width: 56, flexShrink: 0 },
  detail: { flex: 1, minWidth: 0 },
  days:   { width: 40, flexShrink: 0, textAlign: "right", fontFamily: theme.font.mono },
  kept:   { width: 52, flexShrink: 0, textAlign: "right", fontFamily: theme.font.mono },
  num:    { width: 96, flexShrink: 0, textAlign: "right", fontFamily: theme.font.mono },
};

function flattenOpen(positions) {
  return [
    ...getOpenCSPs(positions).map(p => ({ ...p, type: "CSP" })),
    ...getOpenCCs(positions).map(p => ({ ...p, type: "CC" })),
    ...getOpenLEAPs(positions).map(p => ({ ...p, type: "LEAPS" })),
    // Spreads already carry type:"Spread" + their second leg (long_strike/right/is_credit).
    ...getOpenSpreads(positions),
  ];
}

function Card({ label, value, sub, valueColor }) {
  return (
    <div style={{
      flex: "1 1 160px", padding: theme.space[3],
      background: theme.bg.surface, border: `1px solid ${theme.border.default}`,
      borderRadius: theme.radius.md,
    }}>
      <div style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.4px" }}>{label}</div>
      <div style={{ fontSize: theme.size.lg, fontFamily: theme.font.mono, color: valueColor ?? theme.text.primary, marginTop: theme.space[1] }}>{value}</div>
      {sub && <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function StrategyBasketTab({ initialTag = null, entries = [], onEntriesChanged }) {
  const { positions, trades } = useData();
  const { quoteMap } = useQuotes();

  const strategyTags = useMemo(() => {
    const set = new Set();
    for (const e of entries) {
      for (const t of (e.tags ?? [])) if (t.startsWith(STRATEGY_PREFIX)) set.add(t);
    }
    return [...set].sort();
  }, [entries]);

  const [selectedTag, setSelectedTag] = useState(initialTag);
  const activeTag = (selectedTag && strategyTags.includes(selectedTag))
    ? selectedTag
    : (strategyTags[0] ?? null);

  const openPositions = useMemo(() => flattenOpen(positions), [positions]);
  const members = useMemo(
    () => activeTag ? resolveBasket(activeTag, { openPositions, trades: trades ?? [], entries }) : [],
    [activeTag, openPositions, trades, entries],
  );

  const target    = basketTarget(members);
  const deployed  = capitalDeployed(members);
  const realized  = realizedRecovery(members);
  const cushion   = unrealizedCushion(members, quoteMap);

  const coverageWarnings = useMemo(() => shareCoverageWarnings(members), [members]);

  // Which inline affordance is expanded: "shares" | "attribute" | null. A single
  // slot rather than one boolean each — two independent booleans let both panels
  // render stacked at once, and the triggers stay visible so an open panel always
  // has a labelled control that closes it.
  const [openForm, setOpenForm] = useState(null);

  // "Add assigned shares" affordance state.
  const [addForm, setAddForm] = useState({ ticker: "", shares: "", basis: "" });
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState(null);

  const submitAddShares = async () => {
    const ticker = addForm.ticker.trim().toUpperCase();
    const shares = Number(addForm.shares);
    const basis = Number(addForm.basis);
    if (!ticker || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(basis) || basis <= 0) {
      setAddError("Enter a ticker, a positive share count, and a positive basis.");
      return;
    }
    if (!activeTag) { setAddError("No active basket tag."); return; }
    setAddBusy(true);
    setAddError(null);
    try {
      await createJournalEntry({
        entry_type: "position_note",
        ticker,
        type: "Shares",
        strike: null,
        expiry: null,
        entry_date: new Date().toISOString().slice(0, 10),
        tags: [activeTag],
        body: `Assigned ${shares} ${ticker} shares @ $${basis} basis (makeup lot)`,
        source: "Self",
        metadata: { shares, basis },
      });
      setAddForm({ ticker: "", shares: "", basis: "" });
      setOpenForm(null);
      if (onEntriesChanged) await onEntriesChanged();
    } catch (err) {
      setAddError(err.message || "Failed to add shares.");
    } finally {
      setAddBusy(false);
    }
  };

  // "Attribute a closed trade" affordance state — claims a slice (N of M) of a
  // blended trade for this basket.
  const [attrForm, setAttrForm] = useState({ ticker: "", tradeId: "", count: "" });
  const [attrBusy, setAttrBusy] = useState(false);
  const [attrError, setAttrError] = useState(null);

  const resetAttrForm = () => setAttrForm({ ticker: "", tradeId: "", count: "" });

  // Expand one affordance, or collapse it if it is already the open one. Defined
  // below both error states so it closes over them without a forward reference.
  // Deliberately does NOT reset either form: switching panels preserves in-progress
  // input (you peeked, you didn't dismiss). Only Cancel and a successful write clear.
  const toggleForm = (name) => {
    setOpenForm(cur => (cur === name ? null : name));
    setAddError(null);
    setAttrError(null);
  };

  // Only trades with a positive contract count can be sliced — there is no
  // denominator otherwise, and the resolver would silently take them whole.
  const attributableTickers = useMemo(() => {
    const set = new Set();
    for (const t of (trades ?? [])) if (Number(t.contracts) > 0) set.add(t.ticker);
    return [...set].sort();
  }, [trades]);

  // Full candidate list, most recent close first. Kept unsliced so the cap below
  // can be disclosed rather than silently dropping older trades on the floor.
  const attrTradesAll = useMemo(() => {
    if (!attrForm.ticker) return [];
    return (trades ?? [])
      .filter(t => t.ticker === attrForm.ticker && Number(t.contracts) > 0)
      .sort((a, b) => String(b.close_date ?? "").localeCompare(String(a.close_date ?? "")));
  }, [trades, attrForm.ticker]);

  const attributableTrades = useMemo(
    () => attrTradesAll.slice(0, ATTR_TRADE_CAP),
    [attrTradesAll],
  );

  const attrTrade = attributableTrades.find(t => t.id === attrForm.tradeId) ?? null;
  const attrTotal = attrTrade ? Number(attrTrade.contracts) : 0;

  // How much of this trade other journal entries already claim. resolveAttribution
  // caps each entry at the trade's total individually, but nothing caps the SUM
  // across entries — two {contracts: 4} entries on a 12-contract trade would credit
  // 8 with no warning, and over-100% attribution is never a correct state.
  // `entries` already holds every strategy:-tagged row, so this needs no new fetch.
  //
  // Counts BOTH ways an entry can resolve to this trade, mirroring resolveBasket:
  // an explicit trade_id, or — when the entry carries none — a tuple match. Every
  // entry this form writes carries trade_id, but the hand-written SQL rows this
  // form replaces are exactly the population likely to omit it, and
  // strategyBasket.js treats `trade_id: null` + metadata.contracts as a supported
  // shape. A trade_id-only guard would silently miss the prior attributions it
  // exists to catch. tupleMatch(entry, normalizedTrade) is the same call
  // resolveBasket makes at its closedMatch step, so the shapes line up.
  //
  // An entry with no usable metadata.contracts counts as the WHOLE trade, not as
  // zero. That is the same test resolveAttribution applies (non-finite or <= 0 →
  // null → the member owns the trade outright), so a legacy whole-claim consumes
  // the trade here exactly as it does there. Reading only metadata.contracts is
  // what fails OPEN: the pre-attribution rows this form inherits carry
  // `metadata: null` by construction, so every one of them would report 0 claimed
  // and wave through a second full attribution of an already-spoken-for trade.
  //
  // Everything left over is deliberately conservative — it over-counts rather
  // than under-counts, blocking an attribution instead of permitting a double
  // one. Two ways it does: a null-strike/null-expiry Shares entry tuple-matches
  // EVERY Shares trade on that ticker (the same ambiguity resolveBasket has when
  // it picks the first tuple match), and an over-large declared count is summed
  // raw here while resolveAttribution clamps it to the trade's total.
  const attrAlready = attrTrade
    ? entries
        .filter(e => {
          const eTradeId = e.trade_id ?? e.metadata?.trade_id;
          return eTradeId != null
            ? eTradeId === attrTrade.id
            : tupleMatch(e, attrTrade);
        })
        .reduce((s, e) => {
          const c = Number(e.metadata?.contracts);
          return s + (Number.isFinite(c) && c > 0 ? c : attrTotal);
        }, 0)
    : 0;
  const attrRemaining = attrTotal - attrAlready;

  const attrCount = Number(attrForm.count);
  // Contracts are indivisible; only share lots split fractionally. 2.5 of a
  // 4-contract CC is meaningless, so reject it before it reaches the DB.
  const attrNeedsInt = attrTrade != null && attrTrade.type !== "Shares";
  const attrValid = attrTrade != null
    && attrForm.count.trim() !== ""
    && Number.isFinite(attrCount)
    && attrCount > 0
    && attrCount <= attrRemaining
    && (!attrNeedsInt || Number.isInteger(attrCount));
  const attrPreview = attrValid
    ? (attrTrade.premium ?? 0) * attrCount / attrTotal
    : null;

  // The submit button is disabled until valid, so the reason has to live in the
  // hint line — otherwise a bad count produces nothing but a greyed-out button.
  const attrHint = !attrTrade ? null
    : attrRemaining <= 0
      ? `All ${fmtCount(attrTotal)} already attributed to a basket.`
      : attrForm.count.trim() === "" || attrValid ? null
        : attrNeedsInt && Number.isFinite(attrCount) && attrCount > 0 && !Number.isInteger(attrCount)
          ? "Contracts must be a whole number — only share lots split fractionally."
          : `Enter a count between 1 and ${fmtCount(attrRemaining)}.`;

  // Informational line when there is nothing to correct.
  const attrNotes = [
    attrTradesAll.length > ATTR_TRADE_CAP
      ? `Showing the ${ATTR_TRADE_CAP} most recent of ${attrTradesAll.length} ${attrForm.ticker} trades.`
      : null,
    attrTrade && attrAlready > 0
      ? `${fmtCount(attrAlready)} of ${fmtCount(attrTotal)} already attributed.`
      : null,
    "The basket is credited this share of the trade's P/L. The trade's own contract count is the denominator — it is never stored, so the two can't drift.",
  ].filter(Boolean).join(" ");

  const submitAttribution = async () => {
    // The disabled button is the real gate; this only stops a programmatic call
    // from writing a nonsense slice. No message — attrHint already explains why.
    if (!attrValid) return;
    const total = attrTotal;
    setAttrBusy(true);
    setAttrError(null);
    try {
      const unit = attrTrade.type === "Shares" ? "shares" : "contracts";
      await createJournalEntry({
        entry_type: "position_note",
        ticker: attrTrade.ticker,
        type: attrTrade.type,
        strike: attrTrade.strike ?? null,
        expiry: attrTrade.expiry_date ?? null,
        entry_date: new Date().toISOString().slice(0, 10),
        trade_id: attrTrade.id,
        tags: [activeTag],
        body: `Attributed ${fmtCount(attrCount)} of ${fmtCount(total)} ${unit} to the basket (${fmtMoney(attrPreview)}).`,
        source: "Self",
        metadata: { contracts: attrCount },
      });
      resetAttrForm();
      setOpenForm(null);
      if (onEntriesChanged) await onEntriesChanged();
    } catch (err) {
      setAttrError(err.message || "Failed to attribute trade.");
    } finally {
      setAttrBusy(false);
    }
  };

  // "CC $157.50 · 08/07/26 · 4 ct · $2,008"
  const attrTradeLabel = (t) => {
    const strike = t.strike != null ? `$${t.strike} · ` : "";
    const unit = t.type === "Shares" ? "sh" : "ct";
    return `${t.type} ${strike}${fmtDate(t.close_date)} · ${t.contracts} ${unit} · ${fmtMoney(t.premium ?? 0)}`;
  };

  // Transaction-table sort. col=null → natural order (baseline pinned, recovery as resolved).
  // Clicking a header cycles that column asc → desc → back to natural.
  const [sort, setSort] = useState({ col: null, dir: "asc" });
  const toggleSort = (col) => setSort(s =>
    s.col !== col      ? { col, dir: "asc" }
    : s.dir === "asc"  ? { col, dir: "desc" }
    :                    { col: null, dir: "asc" }
  );
  // Sortable header cell — click to sort, arrow shows the active column/direction.
  const Th = (col, label, colStyle, sortable = true) => {
    if (!sortable) return <span style={colStyle}>{label}</span>;
    const active = sort.col === col;
    return (
      <span
        onClick={() => toggleSort(col)}
        style={{ ...colStyle, cursor: "pointer", userSelect: "none", color: active ? theme.text.secondary : undefined }}
      >
        {label}{active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
      </span>
    );
  };

  // Stacked progress: locked-in realized fill + paper unrealized fill toward target.
  const clampPct = (v) => Math.max(0, Math.min(100, v));
  const realizedFill   = target > 0 ? clampPct((Math.max(0, realized) / target) * 100) : 0;
  const cushionPos     = Math.max(0, cushion.total);
  const combinedFill   = target > 0 ? clampPct(((Math.max(0, realized) + cushionPos) / target) * 100) : 0;
  const unrealizedFill = Math.max(0, combinedFill - realizedFill);

  if (strategyTags.length === 0) {
    return <div style={{ padding: theme.space[5], color: theme.text.muted }}>No positions tagged with a <code>strategy:</code> tag yet.</div>;
  }

  return (
    <div>
      {/* Tag selector */}
      <div style={{ display: "flex", gap: theme.space[2], marginBottom: theme.space[4], flexWrap: "wrap" }}>
        {strategyTags.map(t => (
          <button key={t} onClick={() => setSelectedTag(t)} style={{
            padding: "6px 14px", fontSize: theme.size.sm, cursor: "pointer", fontFamily: "inherit",
            background: t === activeTag ? theme.bg.elevated : theme.bg.surface,
            color: t === activeTag ? theme.blue : theme.text.muted,
            border: `1px solid ${t === activeTag ? theme.blue : theme.border.default}`,
            borderRadius: theme.radius.pill,
          }}>{t.replace(STRATEGY_PREFIX, "")}</button>
        ))}
      </div>

      {/* Summary cards */}
      <div style={{ display: "flex", gap: theme.space[3], flexWrap: "wrap", marginBottom: theme.space[4] }}>
        <Card label="Target to recover" value={target > 0 ? fmtMoney(target) : "—"} />
        <Card label="Capital deployed" value={fmtMoney(deployed)} />
        <Card label="Realized recovery" value={fmtMoney(realized)} valueColor={realized >= 0 ? theme.green : theme.red} />
        <Card
          label="Unrealized cushion"
          value={cushion.marked > 0 ? fmtMoney(cushion.total) : "—"}
          valueColor={cushion.total >= 0 ? theme.green : theme.red}
          sub={cushion.unmarked > 0 ? `${cushion.unmarked} unmarked (mark-to-market)` : "mark-to-market"}
        />
      </div>

      {/* Progress bar: realized (solid) + unrealized cushion (lighter) stacked toward target */}
      {target > 0 ? (
        <div style={{ marginBottom: theme.space[5] }}>
          <div style={{ display: "flex", height: 10, background: theme.bg.surface, borderRadius: theme.radius.pill, overflow: "hidden", border: `1px solid ${theme.border.default}` }}>
            <div style={{ width: `${realizedFill}%`, height: "100%", background: theme.green, transition: "width 0.3s" }} />
            <div style={{ width: `${unrealizedFill}%`, height: "100%", background: theme.green, opacity: 0.35, transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: theme.size.xs, color: theme.text.muted, marginTop: theme.space[1] }}>
            {fmtMoney(realized)} realized + {fmtMoney(cushion.total)} unrealized of {fmtMoney(target)} ({combinedFill.toFixed(1)}%)
            {cushion.unmarked > 0 ? ` · ${cushion.unmarked} position${cushion.unmarked > 1 ? "s" : ""} unmarked` : ""}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: theme.size.xs, color: theme.text.subtle, marginBottom: theme.space[5] }}>
          No baseline set — tag the loss trade with <code>role:makeup-baseline</code> to enable the progress bar.
        </div>
      )}

      {/* A/B: makeup basket vs. just holding the closed underlying */}
      {(() => {
        const baseline = members.find(m => m.role === "baseline");
        if (!baseline) return null;
        const cur = quoteMap.get(baseline.ticker)?.mid ?? quoteMap.get(baseline.ticker)?.last ?? null;
        const holdGain = holdCounterfactual(baseline, cur);
        if (holdGain == null) return null;
        const basketGain = realized + cushion.total;
        const maxAbs = Math.max(Math.abs(basketGain), Math.abs(holdGain), 1);
        const delta  = basketGain - holdGain;

        const CmpRow = (label, value) => (
          <div style={{ display: "flex", alignItems: "center", gap: theme.space[3], marginBottom: theme.space[1] }}>
            <span style={{ width: 150, fontSize: theme.size.sm, color: theme.text.secondary }}>{label}</span>
            <span style={{ width: 80, textAlign: "right", fontFamily: theme.font.mono, fontSize: theme.size.sm, color: value >= 0 ? theme.green : theme.red }}>{fmtMoney(value)}</span>
            <div style={{ flex: 1, height: 8, background: theme.bg.base, borderRadius: theme.radius.pill, overflow: "hidden" }}>
              <div style={{ width: `${(Math.abs(value) / maxAbs) * 100}%`, height: "100%", background: value >= 0 ? theme.green : theme.red, transition: "width 0.3s" }} />
            </div>
          </div>
        );

        return (
          <div style={{ marginBottom: theme.space[5], padding: theme.space[3], background: theme.bg.surface, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: theme.space[2] }}>
              <span style={{ fontSize: theme.size.xs, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.4px" }}>vs. holding {baseline.ticker}</span>
              <span style={{ fontSize: theme.size.xs, color: theme.text.subtle }}>since {fmtDate(baseline.closeDate ?? baseline.openDate)}</span>
            </div>
            {CmpRow("Makeup basket", basketGain)}
            {CmpRow(`Hold ${baseline.contracts != null ? baseline.contracts.toLocaleString() : "?"} @ $${baseline.exitCost}`, holdGain)}
            <div style={{ fontSize: theme.size.sm, color: theme.text.secondary, marginTop: theme.space[2] }}>
              → {delta >= 0 ? "Makeup" : "Holding"} ahead by {fmtMoney(Math.abs(delta))}
            </div>
            <div style={{ fontSize: theme.size.xs, color: theme.text.faint ?? theme.text.subtle, marginTop: theme.space[1] }}>
              Mark-to-market since the pivot · not capital-matched · excludes covered-call premium the shares would have earned
            </div>
          </div>
        );
      })()}

      {/* Over-allocation warning: tagged CCs exceed declared shares for a ticker */}
      {coverageWarnings.map(w => (
        <div key={`warn-${w.ticker}`} style={{
          marginBottom: theme.space[2], padding: theme.space[2],
          background: theme.alert.dangerBg, border: `1px solid ${theme.alert.dangerBorder}`,
          borderRadius: theme.radius.sm, fontSize: theme.size.xs, color: theme.text.secondary,
        }}>
          ⚠ {w.ticker}: {w.ccContracts} CC{w.ccContracts > 1 ? "s" : ""} tagged ({w.coveredShares} shares) but only {w.declaredShares} shares declared — over-allocated.
        </div>
      ))}

      {/* Add-assigned-shares affordance */}
      <div style={{ marginBottom: theme.space[3] }}>
        <div style={{ display: "flex", gap: theme.space[2], alignItems: "center", flexWrap: "wrap" }}>
          {[["shares", "+ Add assigned shares"], ["attribute", "+ Attribute a closed trade"]].map(([name, label]) => (
            <button key={name} onClick={() => toggleForm(name)}
              // Locked mid-write: switching panels would unmount the in-flight
              // form and take its "Adding…" state and any error with it.
              disabled={addBusy || attrBusy} style={{
              padding: "6px 12px", fontSize: theme.size.sm, fontFamily: "inherit",
              cursor: (addBusy || attrBusy) ? "default" : "pointer",
              background: openForm === name ? theme.bg.elevated : theme.bg.surface,
              color: openForm === name ? theme.blue : theme.text.secondary,
              border: `1px solid ${openForm === name ? theme.blue : theme.border.default}`,
              borderRadius: theme.radius.sm,
              opacity: (addBusy || attrBusy) ? 0.6 : 1,
            }}>{label}</button>
          ))}
        </div>

        {openForm === "shares" && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: theme.space[2], alignItems: "center",
            marginTop: theme.space[2],
            padding: theme.space[3], background: theme.bg.surface,
            border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md,
          }}>
            <input value={addForm.ticker} placeholder="Ticker"
              onChange={e => setAddForm(f => ({ ...f, ticker: e.target.value }))}
              style={{ width: 80, padding: "6px 8px", fontFamily: "inherit", fontSize: theme.size.sm, background: theme.bg.base, color: theme.text.primary, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm }} />
            <input value={addForm.shares} placeholder="Shares" inputMode="numeric"
              onChange={e => setAddForm(f => ({ ...f, shares: e.target.value }))}
              style={{ width: 80, padding: "6px 8px", fontFamily: theme.font.mono, fontSize: theme.size.sm, background: theme.bg.base, color: theme.text.primary, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm }} />
            <input value={addForm.basis} placeholder="Basis $" inputMode="decimal"
              onChange={e => setAddForm(f => ({ ...f, basis: e.target.value }))}
              style={{ width: 90, padding: "6px 8px", fontFamily: theme.font.mono, fontSize: theme.size.sm, background: theme.bg.base, color: theme.text.primary, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm }} />
            <button onClick={submitAddShares} disabled={addBusy} style={{
              padding: "6px 12px", fontSize: theme.size.sm, cursor: addBusy ? "default" : "pointer", fontFamily: "inherit",
              background: theme.bg.elevated, color: theme.blue,
              border: `1px solid ${theme.blue}`, borderRadius: theme.radius.sm, opacity: addBusy ? 0.6 : 1,
            }}>{addBusy ? "Adding…" : "Add to basket"}</button>
            <button onClick={() => { setOpenForm(null); setAddError(null); setAddForm({ ticker: "", shares: "", basis: "" }); }} disabled={addBusy} style={{
              padding: "6px 12px", fontSize: theme.size.sm, cursor: "pointer", fontFamily: "inherit",
              background: "transparent", color: theme.text.muted,
              border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm,
            }}>Cancel</button>
            <span style={{ flexBasis: "100%", fontSize: theme.size.xs, color: addError ? theme.red : theme.text.subtle }}>
              {addError || `Basis = full assignment strike (premium is booked separately). Then close the CSP as Assigned in your sheet and sync to book the premium.`}
            </span>
          </div>
        )}

        {openForm === "attribute" && (
          <div style={{
            display: "flex", gap: theme.space[2], alignItems: "center", flexWrap: "wrap",
            marginTop: theme.space[2], padding: theme.space[3],
            background: theme.bg.surface, border: `1px solid ${theme.border.default}`,
            borderRadius: theme.radius.md,
          }}>
            <select value={attrForm.ticker}
              onChange={e => setAttrForm({ ticker: e.target.value, tradeId: "", count: "" })}
              style={{
                width: 100, padding: "6px 8px", fontSize: theme.size.sm, fontFamily: "inherit",
                background: theme.bg.base, color: theme.text.primary,
                border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm,
              }}>
              <option value="">Ticker…</option>
              {attributableTickers.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={attrForm.tradeId} disabled={!attrForm.ticker}
              onChange={e => setAttrForm(f => ({ ...f, tradeId: e.target.value, count: "" }))}
              style={{
                flex: "1 1 280px", minWidth: 0, padding: "6px 8px", fontSize: theme.size.sm, fontFamily: "inherit",
                background: theme.bg.base, color: theme.text.primary,
                border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm,
                opacity: attrForm.ticker ? 1 : 0.5,
              }}>
              <option value="">{attrForm.ticker ? "Trade…" : "Pick a ticker first"}</option>
              {attributableTrades.map(t => <option key={t.id} value={t.id}>{attrTradeLabel(t)}</option>)}
            </select>
            <span style={{ fontSize: theme.size.sm, color: theme.text.muted }}>I own</span>
            <input value={attrForm.count} placeholder="N" inputMode="decimal" disabled={!attrTrade}
              onChange={e => setAttrForm(f => ({ ...f, count: e.target.value }))}
              style={{
                width: 56, padding: "6px 8px", fontSize: theme.size.sm, fontFamily: theme.font.mono,
                background: theme.bg.base, color: theme.text.primary,
                border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm,
                opacity: attrTrade ? 1 : 0.5,
              }} />
            {/* "of 9 ct left" once part is spoken for — the bound the input is
                validated against, stated where the count is typed, so it stays
                visible even when attrHint replaces the informational line. */}
            <span style={{ fontSize: theme.size.sm, color: theme.text.muted }}>
              of {attrTrade
                ? `${fmtCount(Math.max(0, attrRemaining))} ${attrTrade.type === "Shares" ? "sh" : "ct"}${attrAlready > 0 ? " left" : ""}`
                : "—"}
            </span>
            <span style={{
              fontSize: theme.size.sm, fontFamily: theme.font.mono,
              color: attrPreview == null ? theme.text.subtle : attrPreview >= 0 ? theme.green : theme.red,
            }}>→ {attrPreview == null ? "—" : fmtMoney(attrPreview)}</span>
            <button onClick={submitAttribution} disabled={attrBusy || !attrValid} style={{
              padding: "6px 12px", fontSize: theme.size.sm, fontFamily: "inherit",
              cursor: (attrBusy || !attrValid) ? "default" : "pointer",
              background: theme.bg.elevated, color: theme.blue,
              border: `1px solid ${theme.blue}`, borderRadius: theme.radius.sm,
              opacity: (attrBusy || !attrValid) ? 0.6 : 1,
            }}>{attrBusy ? "Adding…" : "Add to basket"}</button>
            <button onClick={() => { setOpenForm(null); setAttrError(null); resetAttrForm(); }} disabled={attrBusy} style={{
              padding: "6px 12px", fontSize: theme.size.sm, cursor: "pointer", fontFamily: "inherit",
              background: "transparent", color: theme.text.muted,
              border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.sm,
            }}>Cancel</button>
            {/* Three meanings share this line — write error, blocking hint, passive
                note — and color alone can't distinguish them, so mark the first two
                as an alert and the last as a status. */}
            <span role={(attrError || attrHint) ? "alert" : "status"}
              style={{ flexBasis: "100%", fontSize: theme.size.xs, color: (attrError || attrHint) ? theme.red : theme.text.subtle }}>
              {attrError || attrHint || attrNotes}
            </span>
          </div>
        )}
      </div>

      {/* Transaction log */}
      <div style={{ fontSize: theme.size.sm, color: theme.text.secondary, marginBottom: theme.space[2], textTransform: "uppercase", letterSpacing: "0.4px" }}>Transactions</div>
      {members.length === 0 ? (
        <div style={{ color: theme.text.muted, fontSize: theme.size.sm }}>No members.</div>
      ) : (
        <div style={{
          display: "flex", flexDirection: "column", gap: 1,
          background: theme.border.default,
          border: `1px solid ${theme.border.default}`,
          borderRadius: theme.radius.md, overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", gap: theme.space[3],
            padding: `${theme.space[2]}px ${theme.space[3]}px`,
            background: theme.bg.elevated,
            fontSize: theme.size.xs, color: theme.text.muted,
            textTransform: "uppercase", letterSpacing: "0.4px",
          }}>
            {Th("date", "Date", COL.date)}
            {Th("ticker", "Ticker", COL.ticker)}
            {Th("type", "Type", COL.type)}
            {Th("detail", "Detail", COL.detail, false)}
            {Th("days", "Days", COL.days)}
            {Th("kept", "Kept", COL.kept)}
            {Th("collateral", "Collateral", COL.num)}
            {Th("gl", "G/L", COL.num)}
          </div>

          {(() => {
            const baseline = members.filter(m => m.role === "baseline");
            const recovery = members.filter(m => m.role !== "baseline");

            // Derived values shared by row rendering and column sorting.
            // Days: closed → lifespan; open → days held so far.
            // Kept: closed → stored % of premium kept; open short → premium captured so far
            // (unrealized P/L ÷ premium collected). Long LEAPS / baseline have no premium → null.
            const derive = (m) => {
              const open = m.status === "open";
              const gl = open ? memberUnrealized(m, quoteMap) : m.realized;
              const days = open ? daysSince(m.openDate) : m.daysHeld;
              // Credit spreads behave like shorts for "kept": gl / (credit × contracts × 100) = % of max gain captured.
              const isShort = m.type === "CSP" || m.type === "CC" || (m.type === "Spread" && m.isCredit);
              const kept = m.role === "baseline"
                ? null
                : open
                  ? (isShort && gl != null && m.entryCost && m.contracts
                      ? gl / (m.entryCost * m.contracts * 100)
                      : null)
                  : m.keptPct;
              const collateral = open ? m.capitalFronted : null;
              return { open, gl, days, kept, collateral };
            };

            // Sort the recovery legs by the active column; baseline stays pinned on top.
            // Nulls/blanks always sink to the bottom regardless of direction.
            const sortValue = (m, col) => {
              switch (col) {
                case "date":       return m.closeDate ?? m.openDate ?? null;
                case "ticker":     return m.ticker ?? null;
                case "type":       return m.type ?? null;
                case "days":       return derive(m).days;
                case "kept":       return derive(m).kept;
                case "collateral": return derive(m).collateral;
                case "gl":         return derive(m).gl;
                default:           return null;
              }
            };
            // Compare two members by the active sort column (nulls/blanks sink to the bottom).
            const compareBySort = (a, b) => {
              const va = sortValue(a, sort.col);
              const vb = sortValue(b, sort.col);
              if (va == null && vb == null) return 0;
              if (va == null) return 1;
              if (vb == null) return -1;
              const cmp = (typeof va === "number" && typeof vb === "number")
                ? va - vb
                : String(va).localeCompare(String(vb));
              return sort.dir === "asc" ? cmp : -cmp;
            };
            const sortGroup = (arr) => sort.col ? [...arr].sort(compareBySort) : arr;

            // Open legs always sit above closed legs; the active column sorts within each group.
            const openRecovery   = sortGroup(recovery.filter(m => m.status === "open"));
            const closedRecovery = sortGroup(recovery.filter(m => m.status !== "open"));
            const showGroupLabels = openRecovery.length > 0 && closedRecovery.length > 0;
            const GroupLabel = (text, count) => (
              <div style={{
                display: "flex", gap: theme.space[2], alignItems: "center",
                padding: `${theme.space[1]}px ${theme.space[3]}px`,
                background: theme.bg.elevated, fontSize: theme.size.xs,
                color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.4px",
              }}>
                {text}<span style={{ color: theme.text.subtle }}>· {count}</span>
              </div>
            );

            // Per-type subtotal inside an Open/Closed group. G/L means
            // mark-to-market for open rows and realized for closed ones, which
            // is why the Open/Closed split stays the OUTER grouping — a
            // subtotal spanning both would be meaningless.
            // Recessed (bg.base) rather than raised: it sits UNDER the elevated
            // Open/Closed header, so it must not compete with it.
            const TypeLabel = (type, count, subtotal) => (
              <div style={{
                display: "flex", gap: theme.space[2], alignItems: "center",
                padding: `${theme.space[1]}px ${theme.space[3]}px`,
                background: theme.bg.base, fontSize: theme.size.xs, letterSpacing: "0.4px",
              }}>
                <span style={{ color: TYPE_COLORS[type]?.text ?? theme.text.secondary }}>{type}</span>
                <span style={{ color: theme.text.subtle }}>· {count}</span>
                <span style={{
                  marginLeft: "auto", fontFamily: theme.font.mono,
                  color: subtotal == null ? theme.text.muted : subtotal >= 0 ? theme.green : theme.red,
                }}>{fmtMoney(subtotal)}</span>
              </div>
            );

            // A member's G/L as a NUMBER, or null when there is nothing to sum.
            // Same coerce-then-check guard as fmtMoney, and — again — not a live
            // hazard: `realized` cannot be a string, because it comes from
            // `premium_collected`, an `integer` column PostgREST sends as a JSON
            // number. It is kept because this value feeds a `+` reduce, where a
            // string would CONCATENATE rather than add and produce a silently
            // garbage magnitude instead of an obvious NaN — and the neighbouring
            // `numeric` columns (`strike`, `entry_cost`, `roi`, `kept_pct`) DO
            // arrive as strings, so a future G/L source plausibly could. The
            // "avg kept" line in the footer below is that exact bug, for real.
            // The null check comes first because Number(null) is 0, not NaN,
            // which would book an unmarked open leg as a real $0.
            const glOf = (m) => {
              const raw = derive(m).gl;
              if (raw == null) return null;
              const v = Number(raw);
              return Number.isFinite(v) ? v : null;
            };
            // null (→ "—"), not 0, when nothing in the group is marked: "$0"
            // would read as "this group is flat" rather than "no marks yet".
            // A partially-marked group still sums only what it can see; the
            // Unrealized-cushion card above carries the unmarked count.
            const subtotal = (ms) => ms.reduce((s, m) => {
              const v = glOf(m);
              return v == null ? s : (s ?? 0) + v;
            }, null);

            // One Open/Closed section: its label, then a labelled subtotal per
            // type. A section holding a single type needs no per-type header —
            // it would just restate the section's own count and total.
            const Section = (label, list) => {
              if (list.length === 0) return null;
              const groups = groupMembersByType(list);
              return (
                <>
                  {showGroupLabels && GroupLabel(label, list.length)}
                  {groups.map(({ type, members: ms }) => (
                    <Fragment key={`${label}-${type}`}>
                      {groups.length > 1 && TypeLabel(type, ms.length, subtotal(ms))}
                      {ms.map(Row)}
                    </Fragment>
                  ))}
                </>
              );
            };

            const Row = (m, i) => {
              const { open, gl, days, kept } = derive(m);
              const glColor = gl == null ? theme.text.muted : gl >= 0 ? theme.green : theme.red;
              const keptColor = kept == null ? theme.text.muted : kept >= 0 ? theme.green : theme.red;

              // Closed recovery legs also show their share of the target in the detail.
              const pctOfTarget = (!open && m.role === "recovery" && target > 0 && m.realized != null)
                ? ` · ${((m.realized / target) * 100).toFixed(1)}% of target`
                : "";
              const strikeLabel = m.strike == null ? null
                : (m.type === "Spread" && m.longStrike != null ? `$${m.strike}/${m.longStrike}` : `$${m.strike}`);
              // "3 of 8 ct · " when this member owns only a slice of a blended
              // trade; empty when it owns the whole thing (attribution === null).
              const sliceLabel = m.attribution
                ? `${fmtCount(m.attribution.owned)} of ${fmtCount(m.attribution.total)} ${m.type === "Shares" ? "sh" : "ct"} · `
                : "";
              const detail = m.role === "baseline"
                ? "Baseline loss"
                : `${strikeLabel != null ? `${strikeLabel} · ` : ""}${sliceLabel}${open ? "open" : "closed"}${pctOfTarget}`;

              return (
                <div key={`${m.status}-${m.ticker}-${m.type}-${m.strike}-${m.closeDate ?? m.openDate}-${i}`} style={{
                  display: "flex", alignItems: "center", gap: theme.space[3],
                  padding: `${theme.space[2]}px ${theme.space[3]}px`,
                  background: theme.bg.surface, fontSize: theme.size.sm,
                }}>
                  <span style={{ ...COL.date, fontFamily: theme.font.mono, color: theme.text.muted }}>{fmtDate(m.closeDate ?? m.openDate)}</span>
                  <span style={{ ...COL.ticker, fontWeight: 600 }}>{m.ticker}</span>
                  <span style={{ ...COL.type, color: TYPE_COLORS[m.type]?.text ?? theme.text.secondary }}>{m.type}</span>
                  <span style={{ ...COL.detail, color: theme.text.subtle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
                  <span style={{ ...COL.days, color: theme.text.muted }}>{days != null ? `${days}d` : "—"}</span>
                  <span style={{ ...COL.kept, color: keptColor }}>{fmtKept(kept)}</span>
                  <span style={{ ...COL.num, color: theme.text.subtle }}>{open ? fmtMoney(m.capitalFronted) : "—"}</span>
                  <span style={{ ...COL.num, color: glColor }}>{gl == null ? "—" : fmtMoney(gl)}</span>
                </div>
              );
            };

            // Totals footer — elapsed time since the swap + blended closed-leg stats.
            const pivotDate   = baseline[0]?.closeDate ?? baseline[0]?.openDate ?? null;
            const daysIn      = daysSince(pivotDate);
            const closedRec   = recovery.filter(m => m.status !== "open");
            const realizedTot = closedRec.reduce((s, m) => s + (m.realized ?? 0), 0);
            // Number(v): keptPct comes from `kept_pct`, a `numeric` column, which
            // PostgREST sends as a STRING — an un-coerced `s + v` concatenates, and
            // with two or more closed legs the average comes out NaN and renders "—".
            // (One leg hid it: Number("0" + "0.5263") / 1 is 0.5263.)
            const kepts       = closedRec.map(m => m.keptPct).filter(v => v != null);
            const avgKept     = kepts.length ? kepts.reduce((s, v) => s + Number(v), 0) / kepts.length : null;
            const pctTgt      = target > 0 ? (realizedTot / target) * 100 : null;
            const showFooter  = daysIn != null || closedRec.length > 0;

            return (
              <>
                {baseline.map(Row)}
                {baseline.length > 0 && recovery.length > 0 && (
                  <div style={{ height: 2, background: theme.border.strong }} />
                )}
                {Section("Open", openRecovery)}
                {Section("Closed", closedRecovery)}
                {showFooter && (
                  <div style={{
                    display: "flex", gap: theme.space[2], alignItems: "center", flexWrap: "wrap",
                    padding: `${theme.space[2]}px ${theme.space[3]}px`,
                    background: theme.bg.elevated, fontSize: theme.size.xs,
                    color: theme.text.muted, fontFamily: theme.font.mono,
                  }}>
                    {daysIn != null && (
                      <span style={{ color: theme.text.secondary }}>{daysIn} {daysIn === 1 ? "day" : "days"} in</span>
                    )}
                    {daysIn != null && <span>·</span>}
                    <span style={{ color: theme.text.secondary }}>{closedRec.length} closed</span>
                    {closedRec.length > 0 && (
                      <>
                        <span>·</span>
                        <span style={{ color: realizedTot >= 0 ? theme.green : theme.red }}>{fmtMoney(realizedTot)} realized</span>
                        {avgKept != null && (<><span>·</span><span>{fmtKept(avgKept)} avg kept</span></>)}
                        {pctTgt != null && (<><span>·</span><span style={{ color: theme.text.secondary }}>{pctTgt.toFixed(1)}% of target recovered</span></>)}
                      </>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export default StrategyBasketTab;
