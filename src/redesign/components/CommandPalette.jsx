import { useState, useEffect, useRef, useMemo } from "react";
import { T } from "../theme.js";
import { normalizePositions } from "./focus/PositionsMatrix.jsx";
import { openPosition } from "./PositionDetail.jsx";
import { supabase } from "../../lib/supabase.js";

// Module-level bridge
let _setOpen = null;
export function openCommandPalette() { _setOpen?.(true); }

// ── Host ──────────────────────────────────────────────────────────────────────
export function CommandPaletteHost({ positions, trades, setSurface }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    _setOpen = setOpen;
    return () => { _setOpen = null; };
  }, []);

  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (!open) return null;

  return (
    <CommandPalette
      positions={positions}
      trades={trades}
      setSurface={setSurface}
      onClose={() => setOpen(false)}
    />
  );
}

// ── Palette ───────────────────────────────────────────────────────────────────
function CommandPalette({ positions, trades, setSurface, onClose }) {
  const [query, setQuery]       = useState("");
  const [idx, setIdx]           = useState(0);
  const [journals, setJournals] = useState([]);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Fetch recent journal entries on open — silently swallows errors (dev mode or no supabase)
  useEffect(() => {
    supabase
      .from("journal_entries")
      .select("id, type, mood, title, body, ticker, created_at")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => { if (data) setJournals(data); })
      .catch(() => {});
  }, []);

  const items = useMemo(
    () => buildItems(query, positions, trades, journals, setSurface),
    [query, positions, trades, journals, setSurface]
  );

  useEffect(() => { setIdx(0); }, [query]);

  // Scroll selected into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector(`[data-cp-idx="${idx}"]`);
    if (row) {
      const rb = row.getBoundingClientRect();
      const lb = list.getBoundingClientRect();
      if (rb.bottom > lb.bottom) list.scrollTop += rb.bottom - lb.bottom;
      if (rb.top < lb.top)       list.scrollTop -= lb.top - rb.top;
    }
  }, [idx]);

  const onKey = (e) => {
    if (e.key === "Escape")    { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, items.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const it = items[idx];
      if (it?.run) { it.run(); onClose(); }
    }
  };

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200,
        animation: "cpFade 120ms ease",
      }} />

      <div style={{
        position: "fixed", top: "14vh", left: "50%", transform: "translateX(-50%)",
        width: 640, maxWidth: "calc(100vw - 32px)", maxHeight: "68vh",
        background: T.bg, border: `1px solid ${T.bdS}`,
        boxShadow: "0 20px 60px rgba(0,0,0,0.65)",
        zIndex: 201, display: "flex", flexDirection: "column",
        animation: "cpIn 160ms cubic-bezier(.4,0,.2,1)",
      }}>
        {/* Input row */}
        <div style={{ borderBottom: `1px solid ${T.bd}`, padding: "13px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: T.sm, color: T.tf, fontFamily: T.mono, flexShrink: 0 }}>⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search positions, actions, journal, tickers…  > actions · @ tickers · # tags · / journal"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: T.t1, fontSize: 13, fontFamily: T.mono, letterSpacing: "0.02em",
            }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{
              background: "none", border: "none", color: T.tf, cursor: "pointer",
              fontSize: T.sm, padding: "0 2px", flexShrink: 0,
            }}>✕</button>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} style={{ flex: 1, overflowY: "auto" }}>
          {items.length === 0 ? (
            <div style={{ padding: "40px 20px", textAlign: "center", fontSize: T.sm, color: T.tf, fontFamily: T.mono, letterSpacing: "0.06em" }}>
              no matches · try a different query or prefix
            </div>
          ) : (
            <PaletteList items={items} selectedIdx={idx} onHover={setIdx} onPick={(it) => { it.run?.(); onClose(); }} />
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: `1px solid ${T.bd}`, padding: "7px 18px",
          display: "flex", gap: 16, fontSize: T.xs, color: T.tf, fontFamily: T.mono, letterSpacing: "0.06em",
          alignItems: "center",
        }}>
          <Kbd>↑↓</Kbd><span>navigate</span>
          <Kbd>↵</Kbd><span>select</span>
          <Kbd>esc</Kbd><span>close</span>
          <span style={{ marginLeft: "auto" }}>{items.length} results</span>
        </div>
      </div>

      <style>{`
        @keyframes cpFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cpIn   { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
      `}</style>
    </>
  );
}

function Kbd({ children }) {
  return (
    <kbd style={{
      padding: "1px 6px", border: `1px solid ${T.bd}`,
      background: T.surf, color: T.t2, fontSize: T.xs, fontFamily: "inherit",
      marginRight: 4, borderRadius: 2,
    }}>{children}</kbd>
  );
}

// ── List renderer ─────────────────────────────────────────────────────────────
function PaletteList({ items, selectedIdx, onHover, onPick }) {
  const rows = [];
  let lastGroup = null;
  items.forEach((it, i) => {
    if (it.group !== lastGroup) {
      rows.push(
        <div key={`g-${it.group}-${i}`} style={{
          padding: "7px 18px 3px",
          fontSize: 9, color: T.tf, letterSpacing: "0.14em",
          fontFamily: T.mono, fontWeight: 600,
          borderTop: lastGroup ? `1px solid ${T.hair}` : "none",
          marginTop: lastGroup ? 4 : 0,
        }}>
          {it.group.toUpperCase()}
        </div>
      );
      lastGroup = it.group;
    }
    rows.push(
      <PaletteRow key={`r-${i}`} i={i} it={it} selected={i === selectedIdx} onHover={onHover} onPick={onPick} />
    );
  });
  return <>{rows}</>;
}

function PaletteRow({ i, it, selected, onHover, onPick }) {
  return (
    <div
      data-cp-idx={i}
      onMouseEnter={() => onHover(i)}
      onClick={() => onPick(it)}
      style={{
        display: "grid", gridTemplateColumns: "80px 1fr auto",
        gap: 14, padding: "9px 18px", alignItems: "center", cursor: "pointer",
        background: selected ? T.blue + "14" : "transparent",
        borderLeft: `2px solid ${selected ? T.blue : "transparent"}`,
        transition: "background 0.08s",
      }}
    >
      <span style={{ fontSize: 9, color: it.gColor || T.tf, letterSpacing: "0.1em", fontFamily: T.mono, fontWeight: 600 }}>
        {it.groupLabel}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: T.t1, fontFamily: T.mono, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {it.title}
        </div>
        {it.subtitle && (
          <div style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {it.subtitle}
          </div>
        )}
      </div>
      {it.right && (
        <span style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono }}>{it.right}</span>
      )}
    </div>
  );
}

// ── Item builders ─────────────────────────────────────────────────────────────
function buildItems(rawQuery, positions, trades, journals, setSurface) {
  const q      = rawQuery.trim().toLowerCase();
  let scope    = null;
  let needle   = q;

  if (q.startsWith(">")) { scope = "actions";  needle = q.slice(1).trim(); }
  else if (q.startsWith("@")) { scope = "tickers"; needle = q.slice(1).trim(); }
  else if (q.startsWith("#")) { scope = "tags";    needle = q.slice(1).trim(); }
  else if (q.startsWith("/")) { scope = "journal"; needle = q.slice(1).trim(); }

  const actions     = buildActions(setSurface);
  const posItems    = buildPositions(positions);
  const tickers     = buildTickers(positions);
  const trItems     = buildTrades(trades, setSurface);
  const journalItems = buildJournal(journals, setSurface);

  const match = (it, n) => !n || fuzzy((it.title + " " + (it.subtitle || "")).toLowerCase(), n);
  const filt  = (arr) => arr.filter(it => match(it, needle));

  if (scope === "actions") return filt(actions);
  if (scope === "tickers") return filt(tickers);
  if (scope === "journal") return filt(journalItems);

  if (!needle) {
    return [
      ...actions.slice(0, 4),
      ...posItems.slice(0, 6),
      ...journalItems.slice(0, 3),
      ...trItems.slice(0, 3),
    ];
  }

  return [
    ...filt(actions),
    ...filt(posItems),
    ...filt(tickers).slice(0, 8),
    ...filt(journalItems).slice(0, 5),
    ...filt(trItems).slice(0, 5),
  ];
}

function fuzzy(hay, needle) {
  if (!needle) return true;
  let i = 0;
  for (const c of hay) {
    if (c === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

function buildActions(setSurface) {
  const goExplore = (mode) => {
    setSurface?.("explore");
    window.dispatchEvent(new CustomEvent("tw-explore-mode", { detail: mode }));
  };

  const openJournal = () => {
    setSurface?.("review");
    try { localStorage.setItem("rv2-mode", "journal"); } catch {}
    window.dispatchEvent(new CustomEvent("tw-review-mode", { detail: "journal" }));
  };
  const newEodEntry = () => {
    openJournal();
    setTimeout(() => window.dispatchEvent(new CustomEvent("tw-journal-new")), 50);
  };

  return [
    { group: "actions", groupLabel: "ACTION", gColor: T.mag,  title: "New EOD entry",  subtitle: "open the 3-step ritual modal", run: newEodEntry },
    { group: "actions", groupLabel: "ACTION", gColor: T.mag,  title: "Open journal",   subtitle: "review → ledger feed + EOD + transaction log", run: openJournal },
    { group: "actions", groupLabel: "ACTION", gColor: T.blue, title: "Open Focus",        subtitle: "current state + action queue", run: () => setSurface?.("focus") },
    { group: "actions", groupLabel: "ACTION", gColor: T.blue, title: "Open Portfolio",    subtitle: "explore → allocation + positions", run: () => goExplore("portfolio") },
    { group: "actions", groupLabel: "ACTION", gColor: T.blue, title: "Open Radar",        subtitle: "explore → scanner + BB gauge", run: () => goExplore("radar") },
    { group: "actions", groupLabel: "ACTION", gColor: T.blue, title: "Open Monthly Review", subtitle: "review → monthly calendar + pipeline", run: () => setSurface?.("review") },
    { group: "actions", groupLabel: "ACTION", gColor: T.blue, title: "Open YTD Review",   subtitle: "review → ticker tiles + hold duration", run: () => setSurface?.("review") },
  ];
}

function buildJournal(journals, setSurface) {
  if (!journals?.length) return [];
  const typeLabel = { eod_update: "EOD", trade_note: "TRADE", position_note: "NOTE" };
  return journals.map(j => ({
    group: "journal", groupLabel: "JOURNAL", gColor: T.mag,
    title: j.title || (j.body?.slice(0, 60) + (j.body?.length > 60 ? "…" : "")) || "(no title)",
    subtitle: [
      typeLabel[j.type] || j.type,
      j.mood ? `◆ ${j.mood}` : null,
      j.ticker,
      new Date(j.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    ].filter(Boolean).join(" · "),
    run: () => {
      setSurface?.("review");
      try { localStorage.setItem("rv2-mode", "journal"); } catch {}
      window.dispatchEvent(new CustomEvent("tw-review-mode", { detail: "journal" }));
    },
  }));
}

function buildPositions(positions) {
  if (!positions) return [];
  const rows = normalizePositions(positions);
  return rows.map(p => ({
    group: "positions", groupLabel: "POSITION", gColor: T.cyan,
    title: `${p.ticker} ${p.type}${p.strike ? ` $${p.strike}` : ""}`,
    subtitle: [
      p.dte !== "—" ? `${p.dte}d DTE` : null,
      p.glPct != null ? `${p.glPct >= 0 ? "+" : ""}${p.glPct}%` : null,
      p.priority,
    ].filter(Boolean).join(" · "),
    right: p.priority || null,
    run: () => openPosition(p.id),
  }));
}

function buildTickers(positions) {
  if (!positions) return [];
  const tickers = new Set();
  for (const p of positions.open_csps || []) tickers.add(p.ticker);
  for (const s of positions.assigned_shares || []) tickers.add(s.ticker);
  for (const l of positions.open_leaps || []) tickers.add(l.ticker);
  return [...tickers].sort().map(t => ({
    group: "tickers", groupLabel: "TICKER", gColor: T.green,
    title: t,
    subtitle: "held · open position",
    run: () => {
      const rows = normalizePositions(positions);
      const pos = rows.find(r => r.ticker === t);
      if (pos) openPosition(pos.id);
    },
  }));
}

function buildTrades(trades, setSurface) {
  if (!trades?.length) return [];
  const closed = trades.filter(t => t.close && t.close !== "—").slice(-20).reverse();
  return closed.map(t => ({
    group: "trades", groupLabel: "TRADE", gColor: T.amber,
    title: `${t.ticker} ${t.type}${t.strike ? ` $${t.strike}` : ""}`,
    subtitle: `closed ${t.close} · ${t.premium != null ? (t.premium >= 0 ? "+" : "") + "$" + Math.abs(t.premium).toLocaleString() : "—"}${t.subtype ? " · " + t.subtype : ""}`,
    right: t.premium != null ? (t.premium >= 0 ? "win" : "loss") : null,
    run: () => setSurface?.("review"),
  }));
}
