import { useState, useMemo, useEffect } from "react";
import { T } from "../../theme.js";
import { Frame, Empty } from "../../primitives.jsx";
import { JournalSurface } from "./JournalSurface.jsx";
import { PipelineDetailPanel } from "./PipelineDetailPanel.jsx";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Canonical month list for 2026
const MONTHS_META = [
  { label: "Jan", idx: 0 },
  { label: "Feb", idx: 1 },
  { label: "Mar", idx: 2 },
  { label: "Apr", idx: 3 },
];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr"];

// trade.close is "MM/DD" from normalizeTrade
const tradeMonth = (t) => (t.close ? parseInt(t.close.slice(0, 2), 10) - 1 : -1);
const tradeDay   = (t) => (t.close ? parseInt(t.close.slice(3, 5), 10) : 0);

// "pl" in the design = premium_collected in real data
const tradePl = (t) => t.premium ?? 0;

// Type colors — parallel to TYPE_COLORS, intentional exception per CLAUDE.md
const TYPE_COLORS = {
  CSP:      T.blue,
  CC:       T.green,
  LEAPS:    "#a476f7",
  Spread:   T.amber,
  Interest: T.cyan,
  Shares:   "#f78c6b",
};

function fmt$(n) {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmt$full(n) {
  if (n == null) return "—";
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : ""}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function applyFilters(trades, filters) {
  let out = trades;
  if (filters.type)     out = out.filter(t => t.type === filters.type);
  if (filters.ticker)   out = out.filter(t => t.ticker === filters.ticker);
  if (filters.duration) {
    const d = filters.duration;
    out = out.filter(t => {
      const days = t.days ?? 0;
      if (d === "0-1d")   return days >= 0  && days <= 1;
      if (d === "2-3d")   return days >= 2  && days <= 3;
      if (d === "4-7d")   return days >= 4  && days <= 7;
      if (d === "8-14d")  return days >= 8  && days <= 14;
      if (d === "15-30d") return days >= 15 && days <= 30;
      if (d === "30d+")   return days > 30;
      return true;
    });
  }
  return out;
}

function ytdByTicker(trades) {
  const map = new Map();
  for (const t of trades) {
    const tk = t.ticker;
    if (!map.has(tk)) map.set(tk, { ticker: tk, months: { Jan: 0, Feb: 0, Mar: 0, Apr: 0 }, total: 0, count: 0 });
    const entry = map.get(tk);
    const mi = tradeMonth(t);
    const label = MONTH_LABELS[mi];
    if (label) entry.months[label] += tradePl(t);
    entry.total += tradePl(t);
    entry.count++;
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function holdDurationBuckets(trades) {
  const KEYS = ["0-1d", "2-3d", "4-7d", "8-14d", "15-30d", "30d+"];
  const bucket = (days) => {
    if (days <= 1)  return "0-1d";
    if (days <= 3)  return "2-3d";
    if (days <= 7)  return "4-7d";
    if (days <= 14) return "8-14d";
    if (days <= 30) return "15-30d";
    return "30d+";
  };
  const init = () => Object.fromEntries(Object.keys(TYPE_COLORS).map(t => [t, 0]));
  const data = Object.fromEntries(KEYS.map(k => [k, { key: k, count: 0, pl: 0, byType: init() }]));
  for (const t of trades) {
    const k = bucket(t.days ?? 0);
    data[k].count++;
    data[k].pl += tradePl(t);
    if (data[k].byType[t.type] !== undefined) data[k].byType[t.type]++;
    else data[k].byType[t.type] = 1;
  }
  return KEYS.map(k => data[k]);
}

// ── Review filters bar ────────────────────────────────────────────────────────

function ReviewFilters({ filters, setFilters, clearFilters }) {
  const chips = [];
  if (filters.type)     chips.push({ k: "type",     label: `TYPE · ${filters.type}`,      color: TYPE_COLORS[filters.type] || T.t2 });
  if (filters.ticker)   chips.push({ k: "ticker",   label: `TICKER · ${filters.ticker}`,  color: T.blue });
  if (filters.duration) chips.push({ k: "duration", label: `HELD · ${filters.duration}`,  color: T.cyan });

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      padding: "7px 12px", border: `1px solid ${T.bd}`, background: T.bg,
    }}>
      <span style={{ fontSize: T.xs, color: T.tf, letterSpacing: "0.1em", fontFamily: T.mono }}>FILTERS:</span>
      {chips.length === 0 && (
        <span style={{ fontSize: T.sm, color: T.tf, fontFamily: T.mono }}>
          none · click a ticker tile or duration bucket to filter
        </span>
      )}
      {chips.map(c => (
        <span key={c.k} onClick={() => setFilters(p => ({ ...p, [c.k]: null }))} style={{
          padding: "2px 8px", border: `1px solid ${c.color}`, color: c.color, background: c.color + "14",
          fontSize: T.xs, fontFamily: T.mono, letterSpacing: "0.05em", cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          {c.label} <span style={{ color: T.tf }}>×</span>
        </span>
      ))}
      {chips.length > 0 && (
        <span onClick={clearFilters} style={{
          marginLeft: "auto", fontSize: T.xs, color: T.tm, fontFamily: T.mono,
          cursor: "pointer", textDecoration: "underline",
        }}>Clear all</span>
      )}
    </div>
  );
}

// ── Ticker tiles grid ─────────────────────────────────────────────────────────

function TickerTilesGrid({ tiles, active, onPick }) {
  if (tiles.length === 0) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
      {tiles.map(t => (
        <TickerTile key={t.ticker} t={t} active={t.ticker === active}
          onClick={() => onPick(t.ticker === active ? null : t.ticker)} />
      ))}
    </div>
  );
}

function TickerTile({ t, active, onClick }) {
  const maxAbs = Math.max(1, ...MONTH_LABELS.map(m => Math.abs(t.months[m] || 0)));
  return (
    <div onClick={onClick} style={{
      padding: "12px 12px 10px",
      border: `1px solid ${active ? T.blue : T.bd}`,
      background: active ? T.blue + "08" : T.surf,
      cursor: "pointer",
    }}>
      <div style={{ fontSize: T.sm, color: T.t1, fontFamily: T.mono, fontWeight: 600, letterSpacing: "0.06em" }}>
        {t.ticker}
      </div>
      <div style={{ position: "relative", height: 52, marginTop: 8 }}>
        <div style={{
          position: "absolute", inset: 0,
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2, alignItems: "end",
        }}>
          {MONTH_LABELS.map(m => {
            const v = t.months[m] || 0;
            const h = (Math.abs(v) / maxAbs) * 44;
            const pos = v >= 0;
            return (
              <div key={m} style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                {v !== 0 && (
                  <div style={{
                    position: "absolute", bottom: Math.max(2, h) + 2, left: 0, right: 0,
                    fontSize: 9, color: pos ? T.green : T.red, fontFamily: T.mono, textAlign: "center",
                    lineHeight: 1, whiteSpace: "nowrap",
                  }}>
                    {fmt$(v)}
                  </div>
                )}
                <div style={{
                  width: "100%", height: Math.max(2, h),
                  background: pos ? T.green : T.red, opacity: v === 0 ? 0.15 : 0.85,
                }} />
              </div>
            );
          })}
        </div>
      </div>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2,
        fontSize: 9, color: T.tf, fontFamily: T.mono, marginTop: 4,
        paddingTop: 4, borderTop: `1px solid ${T.hair}`,
      }}>
        {MONTH_LABELS.map(m => <span key={m} style={{ textAlign: "center" }}>{m}</span>)}
      </div>
      <div style={{
        marginTop: 8, paddingTop: 6, borderTop: `1px solid ${T.hair}`,
        fontSize: T.md, color: t.total >= 0 ? T.green : T.red,
        fontFamily: T.mono, fontWeight: 600, textAlign: "center",
      }}>
        {fmt$(t.total)}
      </div>
      <div style={{ fontSize: 9, color: T.tf, fontFamily: T.mono, textAlign: "center", marginTop: 2 }}>
        {t.count} trades
      </div>
    </div>
  );
}

// ── Hold duration bars ────────────────────────────────────────────────────────

function HoldDuration({ trades, activeBucket, onPickBucket }) {
  const buckets = useMemo(() => holdDurationBuckets(trades), [trades]);
  const maxCount = Math.max(1, ...buckets.map(b => b.count));
  const MAX_H = 100;

  return (
    <Frame accent="quiet" title="HOLD DURATION DISTRIBUTION" subtitle="count per bucket">
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${buckets.length}, 1fr)`, gap: 16, alignItems: "end" }}>
        {buckets.map(b => {
          const hasData = b.count > 0;
          const isSweet = b.key === "4-7d";
          const isActive = activeBucket === b.key;
          const color = isActive ? T.cyan : (isSweet ? T.blue : (hasData ? T.blue : T.tf));
          const opacity = hasData ? (isActive || isSweet ? 1 : 0.55) : 0.2;
          const h = (b.count / maxCount) * MAX_H;
          return (
            <div key={b.key}
              onClick={() => hasData && onPickBucket && onPickBucket(b.key)}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 0,
                cursor: hasData ? "pointer" : "default",
                outline: isActive ? `1px solid ${T.cyan}` : "none", outlineOffset: -2,
                padding: 4,
              }}>
              <div style={{ height: MAX_H, width: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
                <div style={{ fontSize: T.xs, color: isActive ? T.cyan : (hasData ? T.t2 : T.tf), fontFamily: T.mono, fontWeight: 600, marginBottom: 4 }}>
                  {b.count}
                </div>
                <div style={{ width: "100%", maxWidth: 100, height: Math.max(4, h), background: color, opacity }} />
              </div>
              <div style={{ fontSize: T.xs, color: isActive ? T.cyan : (isSweet ? T.blue : T.tm), fontFamily: T.mono, marginTop: 6, letterSpacing: "0.05em" }}>
                {b.key}
              </div>
              <div style={{ fontSize: T.xs, color: hasData ? T.green : T.tf, fontFamily: T.mono, marginTop: 2 }}>
                {fmt$(b.pl)}
              </div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

// ── Ledger ────────────────────────────────────────────────────────────────────

const LEDGER_COLS = [
  { k: "ticker",  label: "TICKER",  w: "52px"  },
  { k: "type",    label: "TYPE",    w: "56px"  },
  { k: "status",  label: "STATUS",  w: "64px"  },
  { k: "strike",  label: "STRIKE",  w: "56px",  r: true },
  { k: "ct",      label: "CT",      w: "32px",  r: true },
  { k: "open",    label: "OPEN",    w: "48px"  },
  { k: "close",   label: "CLOSE",   w: "48px"  },
  { k: "days",    label: "DAYS",    w: "40px",  r: true },
  { k: "premium", label: "PREMIUM", w: "72px",  r: true },
  { k: "kept",    label: "KEPT",    w: "44px",  r: true },
];
const LEDGER_TPL = LEDGER_COLS.map(c => c.w).join(" ");

function Ledger({ trades, title }) {
  const total = trades.reduce((s, t) => s + tradePl(t), 0);
  return (
    <Frame accent="quiet" title={title.toUpperCase()} subtitle={`${trades.length} trades`} right={
      <span style={{ fontSize: T.sm, color: total >= 0 ? T.green : T.red, fontFamily: T.mono, fontWeight: 600 }}>
        {fmt$full(total)}
      </span>
    }>
      {trades.length === 0 ? (
        <div style={{ padding: "12px 0", fontSize: T.sm, color: T.tf, fontFamily: T.mono }}>No trades match the current filter.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 640 }}>
            <div style={{
              display: "grid", gridTemplateColumns: LEDGER_TPL, gap: 10,
              padding: "4px 2px 6px", fontSize: T.xs, letterSpacing: "0.1em", color: T.tf,
              borderBottom: `1px solid ${T.bd}`, fontFamily: T.mono,
            }}>
              {LEDGER_COLS.map(c => <span key={c.k} style={{ textAlign: c.r ? "right" : "left" }}>{c.label}</span>)}
            </div>
            {trades.map((t, i) => <LedgerRow key={i} t={t} />)}
          </div>
        </div>
      )}
    </Frame>
  );
}

function LedgerRow({ t }) {
  const pl = tradePl(t);
  const typeColor = TYPE_COLORS[t.type] || T.tm;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: LEDGER_TPL, gap: 10, alignItems: "center",
      padding: "6px 2px", borderBottom: `1px solid ${T.hair}`,
      fontFamily: T.mono, fontSize: T.sm,
    }}>
      <span style={{ color: T.t1, fontWeight: 600 }}>{t.ticker}</span>
      <span style={{
        padding: "1px 6px", borderRadius: 2, fontSize: 9, letterSpacing: "0.05em",
        color: typeColor, background: typeColor + "18", border: `1px solid ${typeColor}55`,
        display: "inline-block",
      }}>{t.type?.toUpperCase()}</span>
      <span style={{ color: T.tm, fontSize: T.xs }}>{t.subtype || "—"}</span>
      <span style={{ textAlign: "right", color: T.t2 }}>{t.strike ? `$${t.strike}` : "—"}</span>
      <span style={{ textAlign: "right", color: T.t2 }}>{t.contracts || "—"}</span>
      <span style={{ color: T.tm }}>{t.open || "—"}</span>
      <span style={{ color: T.tm }}>{t.close || "—"}</span>
      <span style={{ textAlign: "right", color: T.tm }}>{t.days != null ? `${t.days}d` : "—"}</span>
      <span style={{ textAlign: "right", color: pl >= 0 ? T.green : T.red, fontWeight: 600 }}>{fmt$full(pl)}</span>
      <span style={{ textAlign: "right", color: T.t2 }}>{t.kept || "—"}</span>
    </div>
  );
}

// ── Monthly calendar ──────────────────────────────────────────────────────────

// Day-of-week for Jan 1 2026 = Thursday (4). Derive month start DOW.
const MONTH_START_DOW = [4, 0, 0, 3]; // Jan–Apr 2026
const DAYS_IN_MONTH   = [31, 28, 31, 30];
const DOW_LABELS      = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function MonthCalendar({ monthIdx, trades, selectedDay, setSelectedDay }) {
  const startDOW = MONTH_START_DOW[monthIdx] ?? 0;
  const numDays  = DAYS_IN_MONTH[monthIdx] ?? 30;

  const cells = [];
  for (let i = 0; i < startDOW; i++) cells.push({ pad: true });
  for (let d = 1; d <= numDays; d++) {
    const dayTrades = trades.filter(t => tradeDay(t) === d);
    cells.push({ pad: false, day: d, trades: dayTrades });
  }
  while (cells.length % 7 !== 0) cells.push({ pad: true });

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div style={{ border: `1px solid ${T.bd}`, background: T.surf }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr) 80px", borderBottom: `1px solid ${T.bd}` }}>
        {DOW_LABELS.map(d => (
          <div key={d} style={{
            padding: "7px 8px", fontSize: T.xs, letterSpacing: "0.1em", color: T.tf,
            fontFamily: T.mono, borderRight: `1px solid ${T.hair}`,
          }}>{d}</div>
        ))}
        <div style={{ padding: "7px 8px", fontSize: T.xs, letterSpacing: "0.1em", color: T.tf, fontFamily: T.mono }}>TOTAL</div>
      </div>
      {weeks.map((w, wi) => {
        const weekTrades = w.filter(c => !c.pad).flatMap(c => c.trades);
        const weekPl = weekTrades.reduce((s, t) => s + tradePl(t), 0);
        return (
          <div key={wi} style={{
            display: "grid", gridTemplateColumns: "repeat(7, 1fr) 80px",
            borderBottom: wi === weeks.length - 1 ? "none" : `1px solid ${T.hair}`,
            minHeight: 72,
          }}>
            {w.map((c, ci) => {
              if (c.pad) {
                return <div key={ci} style={{ borderRight: `1px solid ${T.hair}`, background: T.bg + "40" }} />;
              }
              const { day, trades: dt } = c;
              const pl = dt.reduce((s, t) => s + tradePl(t), 0);
              const active = dt.length > 0;
              const profit = pl >= 0;
              const selected = selectedDay === day;
              return (
                <div key={ci}
                  onClick={() => active && setSelectedDay(selected ? null : day)}
                  style={{
                    padding: "5px 7px", borderRight: `1px solid ${T.hair}`,
                    cursor: active ? "pointer" : "default",
                    background: active ? (profit ? T.green : T.red) + "14" : "transparent",
                    outline: selected ? `2px solid ${T.blue}` : "none", outlineOffset: -2,
                  }}>
                  <div style={{ fontSize: T.xs, color: active ? T.t2 : T.tf, fontFamily: T.mono }}>{day}</div>
                  {active && (
                    <div style={{ marginTop: 2 }}>
                      <div style={{ fontSize: T.sm, color: profit ? T.green : T.red, fontFamily: T.mono, fontWeight: 600 }}>
                        {fmt$full(pl)}
                      </div>
                      <div style={{ fontSize: 9, color: T.tm, fontFamily: T.mono, marginTop: 1 }}>
                        {dt.length} trade{dt.length > 1 ? "s" : ""}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{
              padding: "7px 8px", borderLeft: `1px solid ${T.hair}`,
              display: "flex", flexDirection: "column", justifyContent: "center",
            }}>
              <div style={{ fontSize: 9, color: T.tf, fontFamily: T.mono, letterSpacing: "0.08em" }}>WK {wi + 1}</div>
              {weekTrades.length > 0 ? (
                <>
                  <div style={{ fontSize: T.sm, color: weekPl >= 0 ? T.green : T.red, fontFamily: T.mono, fontWeight: 600 }}>
                    {fmt$full(weekPl)}
                  </div>
                  <div style={{ fontSize: 9, color: T.tf, fontFamily: T.mono }}>{weekTrades.length}t</div>
                </>
              ) : (
                <div style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono }}>—</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Premium Pipeline ──────────────────────────────────────────────────────────

function PremiumPipeline({ account, positions }) {
  const [captureRate, setCaptureRate] = useState(0.60);
  const [showDetail, setShowDetail] = useState(false);

  // Listen for external expand request from the Focus PipelineGauge "DETAIL →" button.
  useEffect(() => {
    const h = () => setShowDetail(true);
    window.addEventListener("tw-pipeline-detail", h);
    return () => window.removeEventListener("tw-pipeline-detail", h);
  }, []);

  // Gross open premium: sum of open CSP + CC premium_collected.
  const openCSPs = positions?.open_csps ?? [];
  const openCCs  = (positions?.assigned_shares ?? []).filter(s => s.active_cc).map(s => s.active_cc);
  const grossOpen = [...openCSPs, ...openCCs].reduce((s, p) => s + (p.premium_collected || 0), 0);

  const mtdCollected = account?.month_to_date_premium     ?? 0;
  const baseline     = account?.monthly_targets?.baseline ?? 15000;

  // Prefer v2 forecast when available; fall back to flat captureRate.
  const fc = account?.forecast ?? null;
  const pipelineIsV2 = fc?.this_month_remaining != null;
  const expected  = pipelineIsV2 ? fc.this_month_remaining : grossOpen * captureRate;
  const implied   = pipelineIsV2 ? fc.month_total          : mtdCollected + expected;
  const gap       = pipelineIsV2 ? fc.target_gap           : implied - baseline;
  const v2Forward = fc?.forward_pipeline_premium ?? null;

  const captureLabel = pipelineIsV2 ? "Expected (v2)" : `Expected (${(captureRate*100).toFixed(0)}%)`;

  return (
    <Frame accent="quiet" title="PREMIUM PIPELINE" right={
      pipelineIsV2 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: T.xs, fontFamily: T.mono }}>
          <span style={{ color: T.green, letterSpacing: "0.08em" }} title="v2 per-position auto-calibrated forecast">
            v2 · AUTO
          </span>
          <button
            onClick={() => setShowDetail(v => !v)}
            style={{
              background: "transparent", border: `1px solid ${T.bd}`, color: T.tm,
              padding: "3px 8px", fontSize: T.xs, letterSpacing: "0.12em",
              fontFamily: T.mono, borderRadius: T.rSm, cursor: "pointer",
            }}
          >
            {showDetail ? "HIDE DETAIL" : "PIPELINE DETAIL →"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: T.xs, color: T.tm, fontFamily: T.mono }}>
          capture:
          <select value={String(captureRate)} onChange={e => setCaptureRate(parseFloat(e.target.value))} style={{
            background: T.bg, color: T.t2, border: `1px solid ${T.bd}`,
            padding: "2px 6px", fontSize: T.xs, fontFamily: T.mono,
          }}>
            {["0.40","0.50","0.60","0.70","0.80"].map(v => (
              <option key={v} value={v}>{(parseFloat(v)*100).toFixed(0)}%</option>
            ))}
          </select>
        </div>
      )
    }>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
        {[
          { label: "Gross open",     value: fmt$full(grossOpen) },
          { label: captureLabel,     value: `~${fmt$full(expected)}` },
          { label: "MTD collected",  value: fmt$full(mtdCollected) },
          { label: "Implied total",  value: `~${fmt$full(implied)}` },
          { label: "Gap to baseline",value: (
            <span style={{ color: gap >= 0 ? T.green : T.amber }}>
              {gap >= 0 ? "+" : "-"}${Math.abs(gap).toLocaleString()}
              <span style={{ color: T.tf, fontSize: T.xs }}> to ${(baseline/1000).toFixed(0)}k</span>
            </span>
          )},
        ].map(({ label, value }) => (
          <div key={label}>
            <div style={{ fontSize: T.xs, color: T.tf, fontFamily: T.mono, letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: T.md, color: T.t1, fontFamily: T.mono, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>

      {pipelineIsV2 && fc?.calibration && (
        <div style={{ fontSize: T.xs, color: T.tf, marginTop: 10, fontFamily: T.mono }}>
          calibrated {fc.calibration.calibration_date} · n={fc.calibration.sample_size}
          {v2Forward != null && <> · forward pipeline ~{fmt$full(v2Forward)}</>}
        </div>
      )}

      {pipelineIsV2 && showDetail && (
        <PipelineDetailPanel account={account} positions={positions} />
      )}
    </Frame>
  );
}

// ── Monthly mode ──────────────────────────────────────────────────────────────

function ReviewMonthly({ trades, account, positions, filters, toggleFilter }) {
  const [monthIdx, setMonthIdx] = useState(() => {
    const maxMonth = Math.max(...trades.map(t => tradeMonth(t)).filter(m => m >= 0));
    return maxMonth >= 0 ? maxMonth : 3;
  });
  const [selectedDay, setSelectedDay] = useState(null);

  const monthTrades = applyFilters(
    trades.filter(t => tradeMonth(t) === monthIdx),
    filters
  );
  const monthPl = monthTrades.reduce((s, t) => s + tradePl(t), 0);

  if (trades.length === 0) {
    return (
      <Frame accent="quiet" title="MONTHLY REVIEW" subtitle="no closed trades yet">
        <Empty glyph="◻" accent="quiet" compact title="Nothing to review yet."
          body="The premium pipeline, calendar grid, and monthly ledger light up as soon as you close your first position." />
      </Frame>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PremiumPipeline account={account} positions={positions} />

      {/* Month tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 2 }}>
          {MONTHS_META.map(m => {
            const active = m.idx === monthIdx;
            return (
              <button key={m.label} onClick={() => { setMonthIdx(m.idx); setSelectedDay(null); }} style={{
                padding: "4px 12px", background: "transparent",
                border: "none", borderBottom: `2px solid ${active ? T.blue : "transparent"}`,
                color: active ? T.t1 : T.tm,
                fontSize: T.sm, fontFamily: T.mono, letterSpacing: "0.04em", cursor: "pointer",
              }}>{m.label} 2026</button>
            );
          })}
        </div>
        <div style={{ marginLeft: "auto", fontSize: T.sm, color: T.tm, fontFamily: T.mono }}>
          {MONTH_LABELS[monthIdx]} P&L:{" "}
          <span style={{ color: monthPl >= 0 ? T.green : T.red, fontWeight: 600 }}>{fmt$full(monthPl)}</span>
        </div>
      </div>

      <MonthCalendar monthIdx={monthIdx} trades={monthTrades} selectedDay={selectedDay} setSelectedDay={setSelectedDay} />

      {selectedDay
        ? <Ledger trades={monthTrades.filter(t => tradeDay(t) === selectedDay)}
            title={`${MONTH_LABELS[monthIdx]} ${selectedDay}, 2026`} />
        : <Ledger trades={monthTrades} title={`${MONTH_LABELS[monthIdx]} 2026 — All Transactions`} />
      }
    </div>
  );
}

// ── YTD mode ──────────────────────────────────────────────────────────────────

function ReviewYTD({ trades, filters, toggleFilter }) {
  const netRealized = trades.reduce((s, t) => s + tradePl(t), 0);
  const filtered = applyFilters(trades, filters);
  const tiles = useMemo(() => ytdByTicker(applyFilters(trades, { ...filters, ticker: null })), [trades, filters]);

  const typeGroups = useMemo(() => {
    const groups = {};
    trades.forEach(t => { groups[t.type] = (groups[t.type] || 0) + tradePl(t); });
    return [
      { k: null, label: `ALL (${trades.length})`, pl: netRealized, color: T.bd },
      ...Object.entries(groups).map(([type, pl]) => ({
        k: type,
        label: `${type} (${trades.filter(t => t.type === type).length}) · ${fmt$(pl)}`,
        pl, color: TYPE_COLORS[type] || T.t2,
      })),
    ];
  }, [trades]);

  if (trades.length === 0) {
    return (
      <Frame accent="quiet" title="YTD REVIEW" subtitle="2026 · no closed trades yet">
        <Empty glyph="∅" accent="quiet" compact title="No closed trades this year."
          body="Once you close your first position it lands here. Ticker tiles, hold-duration distribution, and the full ledger populate automatically." />
      </Frame>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Summary */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", fontFamily: T.mono }}>
        <span style={{ fontSize: T.lg, color: T.t1 }}>{filtered.length} trades</span>
        <span style={{ fontSize: T.sm, color: T.tf }}>·</span>
        <span style={{ fontSize: T.lg, color: netRealized >= 0 ? T.green : T.red, fontWeight: 600 }}>
          {fmt$full(netRealized)} net realized
        </span>
        {(filters.ticker || filters.type || filters.duration) && (
          <span style={{ fontSize: T.xs, color: T.tf, letterSpacing: "0.08em" }}>
            SHOWING: {filters.ticker || "all tickers"} · {filters.type || "all types"}
            {filters.duration ? ` · ${filters.duration}` : ""}
          </span>
        )}
      </div>

      {/* Type group pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {typeGroups.map(g => {
          const isActive = g.k === filters.type;
          return (
            <button key={g.k || "all"} onClick={() => toggleFilter("type", g.k)} style={{
              padding: "3px 12px", borderRadius: 999,
              border: `1px solid ${isActive ? g.color : T.bd}`,
              background: isActive ? g.color + "20" : "transparent",
              color: isActive ? (g.k === null ? T.t1 : g.color) : T.tm,
              fontSize: T.xs, fontFamily: T.mono, letterSpacing: "0.05em",
              whiteSpace: "nowrap", cursor: "pointer",
            }}>{g.label}</button>
          );
        })}
      </div>

      <TickerTilesGrid tiles={tiles} active={filters.ticker} onPick={tk => toggleFilter("ticker", tk)} />

      <HoldDuration trades={filtered} activeBucket={filters.duration}
        onPickBucket={b => toggleFilter("duration", b)} />

      <Ledger trades={filtered} title="All Transactions" />
    </div>
  );
}

// ── Main surface ──────────────────────────────────────────────────────────────

export function ReviewSurface({ trades, account, positions }) {
  const [mode, setMode] = useState(() => {
    try { const s = localStorage.getItem("rv2-mode"); return (s === "monthly" || s === "ytd" || s === "journal") ? s : "monthly"; }
    catch { return "monthly"; }
  });
  const setModePersist = (m) => {
    setMode(m);
    try { localStorage.setItem("rv2-mode", m); } catch {}
  };

  // Command palette / keyboard shortcuts fire this to jump to journal mode
  useEffect(() => {
    const h = (e) => {
      const v = e.detail;
      if (v === "journal" || v === "monthly" || v === "ytd") setMode(v);
    };
    window.addEventListener("tw-review-mode", h);
    return () => window.removeEventListener("tw-review-mode", h);
  }, []);

  const [filters, setFiltersRaw] = useState({ type: null, ticker: null, duration: null });
  const setFilters = (f) => setFiltersRaw(typeof f === "function" ? f(filters) : f);
  const toggleFilter = (key, value) =>
    setFilters(prev => ({ ...prev, [key]: prev[key] === value ? null : value }));
  const clearFilters = () => setFilters({ type: null, ticker: null, duration: null });

  // Closed trades only (trades with a close date)
  const closedTrades = useMemo(
    () => (trades || []).filter(t => t.close && t.close !== "—"),
    [trades]
  );

  const TABS = [
    { k: "monthly",  label: "Monthly"  },
    { k: "ytd",      label: "YTD"      },
    { k: "journal",  label: "Journal",  accent: T.mag },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Mode tabs */}
      <div style={{ display: "flex", gap: 6 }}>
        {TABS.map(tab => {
          const active = tab.k === mode;
          const color  = tab.accent || T.blue;
          return (
            <button key={tab.k} onClick={() => setModePersist(tab.k)} style={{
              padding: "5px 14px", borderRadius: 999,
              border: `1px solid ${active ? color : T.bd}`,
              background: active ? color + "18" : "transparent",
              color: active ? color : T.tm,
              fontSize: T.sm, fontFamily: T.mono, letterSpacing: "0.04em", cursor: "pointer",
            }}>{tab.label}</button>
          );
        })}
      </div>

      {mode !== "journal" && (
        <ReviewFilters filters={filters} setFilters={setFilters} clearFilters={clearFilters} />
      )}

      {mode === "monthly" && (
        <ReviewMonthly trades={closedTrades} account={account} positions={positions} filters={filters} toggleFilter={toggleFilter} />
      )}
      {mode === "ytd" && (
        <ReviewYTD trades={closedTrades} filters={filters} toggleFilter={toggleFilter} />
      )}
      {mode === "journal" && (
        <JournalSurface trades={trades} positions={positions} account={account} />
      )}
    </div>
  );
}
