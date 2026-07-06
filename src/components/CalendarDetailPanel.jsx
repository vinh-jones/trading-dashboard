import { Fragment, useState } from "react";
import { formatDollarsFull, formatExpiry } from "../lib/format";
import { TYPE_COLORS, SUBTYPE_LABELS, MONTHS } from "../lib/constants";
import { theme } from "../lib/theme";

// Desktop columns, in render order. `key: null` = not sortable (sorting Status /
// Strike / Ct / Kept / the delete column doesn't earn its keep).
const COLS = [
  { label: "Ticker", key: "ticker" },
  { label: "Type", key: "type" },
  { label: "Status", key: null },
  { label: "Strike", key: null },
  { label: "Ct", key: null },
  { label: "Open", key: "open" },
  { label: "Close", key: "close" },
  { label: "Expiry", key: "expiry" },
  { label: "Days", key: "days" },
  { label: "Premium", key: "premium" },
  { label: "Kept", key: null },
  { label: "", key: null },
];

// Pull a comparable value for a sort column from either a closed trade or an
// open (expiring) position — the two carry different field names. Dates sort by
// their ISO field (open_date / expiry_date / closeDate) so prior-year opens land
// chronologically rather than by their MM/DD label.
function sortValue(row, key) {
  switch (key) {
    case "ticker":  return row.ticker || "";
    case "type":    return row.type || "";
    case "open":    return row.open_date || null;
    case "close":   return row.closeDate ? row.closeDate.getTime() : null;
    case "expiry":  return row.expiry_date || null;
    case "days":    return row.days != null ? row.days : null;
    case "premium": return row.premium != null ? row.premium
                         : (row.premium_collected != null ? row.premium_collected : null);
    default:        return null;
  }
}

function makeComparator(sort) {
  return (a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    // Nulls always sort last, regardless of direction.
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === "number" && typeof vb === "number"
      ? va - vb
      : String(va).localeCompare(String(vb));
    return sort.dir === "asc" ? cmp : -cmp;
  };
}

export function CalendarDetailPanel({
  selectedDay,
  selectedWeek,
  displayClosed,
  displayExpiring,
  hasDisplay,
  dailyData,
  weeklyTotals,
  calMonth,
  isMobile,
  deleteTrade,
}) {
  // Transient view tweaks — reset whenever the panel remounts (new day/week/month).
  const [sort, setSort] = useState(null);          // { key, dir } | null
  const [groupByTicker, setGroupByTicker] = useState(false);

  if (!hasDisplay) return null;

  const comparator = sort ? makeComparator(sort) : null;
  const orderRows = (rows) => (comparator ? [...rows].sort(comparator) : rows);

  const toggleSort = (key) =>
    setSort((s) =>
      s && s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );

  // When grouping, fold closed + expiring rows into per-ticker blocks
  // (alphabetical), each block ordered by the active sort column.
  const groups = (() => {
    if (!groupByTicker) return null;
    const map = new Map();
    const bucket = (ticker) => {
      let g = map.get(ticker);
      if (!g) { g = { ticker, closed: [], expiring: [], premium: 0 }; map.set(ticker, g); }
      return g;
    };
    displayClosed.forEach((t) => {
      const g = bucket(t.ticker);
      g.closed.push(t);
      g.premium += t.premium || 0;
    });
    displayExpiring.forEach((p) => {
      const g = bucket(p.ticker);
      g.expiring.push(p);
      g.premium += p.premium_collected || 0;
    });
    return [...map.values()]
      .sort((a, b) => a.ticker.localeCompare(b.ticker))
      .map((g) => ({
        ...g,
        closed: orderRows(g.closed),
        expiring: orderRows(g.expiring),
        count: g.closed.length + g.expiring.length,
      }));
  })();

  // ---- Desktop row renderers ----
  const closedRow = (t, key) => {
    const tc = TYPE_COLORS[t.type] || {};
    const isLoss = t.premium < 0;
    return (
      <tr key={key} style={{ borderBottom: `1px solid ${theme.bg.surface}` }}>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontWeight: 600, color: theme.text.primary }}>{t.ticker}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px` }}>
          <span style={{ background: tc.bg, color: tc.text, padding: `2px ${theme.space[2]}px`, borderRadius: theme.radius.sm, fontSize: theme.size.sm, fontWeight: 500 }}>
            {t.type}
          </span>
        </td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted, fontSize: theme.size.sm }}>{SUBTYPE_LABELS[t.subtype] || t.subtype || "Closed"}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.secondary }}>{t.strike ? `$${t.strike}` : "—"}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{t.contracts || "—"}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{t.open}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{t.close}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{t.expiry !== "—" ? t.expiry : "—"}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{t.days != null ? `${t.days}d` : "—"}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontWeight: 600, color: isLoss ? theme.red : theme.green }}>
          {formatDollarsFull(t.premium)}
        </td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{t.kept}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[1]}px` }}>
          <button
            onClick={() => {
              if (window.confirm(`Delete ${t.ticker} ${t.type} closed ${t.close}?`)) deleteTrade(t);
            }}
            title="Delete trade"
            style={{ background: "none", border: "none", cursor: "pointer", color: theme.text.subtle, fontSize: theme.size.md, padding: `${theme.space[1]}px ${theme.space[1]}px`, lineHeight: 1, borderRadius: theme.radius.sm }}
            onMouseEnter={e => e.currentTarget.style.color = theme.red}
            onMouseLeave={e => e.currentTarget.style.color = theme.text.subtle}
          >×</button>
        </td>
      </tr>
    );
  };

  const expiringRow = (p, key) => {
    const tc = TYPE_COLORS[p.type] || {};
    return (
      <tr key={key} style={{ borderBottom: `1px solid ${theme.bg.surface}`, background: theme.bg.elevated }}>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontWeight: 600, color: theme.text.primary }}>{p.ticker}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px` }}>
          <span style={{ background: tc.bg, color: tc.text, padding: `2px ${theme.space[2]}px`, borderRadius: theme.radius.sm, fontSize: theme.size.sm, fontWeight: 500 }}>
            {p.type}
          </span>
        </td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontSize: theme.size.sm, color: theme.blue }}>Expires {formatExpiry(p.expiry_date)}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.secondary }}>{p.strike ? `$${p.strike}` : "—"}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{p.contracts || "—"}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>{p.open_date ? p.open_date.slice(5).replace("-", "/") : "—"}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>—</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.blue }}>{p.expiry_date ? p.expiry_date.slice(5).replace("-", "/") : "—"}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>—</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, fontWeight: 600, color: theme.green }}>{formatDollarsFull(p.premium_collected)}</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, color: theme.text.muted }}>—</td>
        <td style={{ padding: `${theme.space[2]}px ${theme.space[2]}px` }}></td>
      </tr>
    );
  };

  const groupHeaderRow = (g) => (
    <tr key={`grp-${g.ticker}`} style={{ background: theme.bg.base }}>
      <td colSpan={12} style={{ padding: `${theme.space[2]}px ${theme.space[2]}px`, borderTop: `1px solid ${theme.border.default}`, borderBottom: `1px solid ${theme.border.default}` }}>
        <span style={{ fontWeight: 700, color: theme.text.primary, fontSize: theme.size.sm }}>{g.ticker}</span>
        <span style={{ color: theme.text.subtle, fontSize: theme.size.xs, marginLeft: theme.space[2] }}>
          {g.count} row{g.count !== 1 ? "s" : ""}
        </span>
        <span style={{ color: g.premium >= 0 ? theme.green : theme.red, fontSize: theme.size.xs, fontWeight: 600, marginLeft: theme.space[2] }}>
          {formatDollarsFull(g.premium)}
        </span>
      </td>
    </tr>
  );

  // ---- Mobile card renderers ----
  const closedCard = (t, key) => {
    const tc = TYPE_COLORS[t.type] || {};
    const isLoss = t.premium < 0;
    return (
      <div key={key} style={{ background: theme.bg.base, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md, padding: `${theme.space[2]}px ${theme.space[3]}px` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[1] }}>
          <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
            <span style={{ fontWeight: 700, color: theme.text.primary, fontSize: theme.size.md }}>{t.ticker}</span>
            <span style={{ background: tc.bg, color: tc.text, padding: `2px ${theme.space[2]}px`, borderRadius: theme.radius.sm, fontSize: theme.size.sm, fontWeight: 500 }}>{t.type}</span>
            <span style={{ color: theme.text.muted, fontSize: theme.size.sm }}>{SUBTYPE_LABELS[t.subtype] || t.subtype || "Closed"}</span>
          </div>
          <span style={{ fontWeight: 600, color: isLoss ? theme.red : theme.green, fontSize: theme.size.md }}>{formatDollarsFull(t.premium)}</span>
        </div>
        <div style={{ display: "flex", gap: theme.space[3], fontSize: theme.size.sm, color: theme.text.muted, flexWrap: "wrap" }}>
          {t.strike && <span>${t.strike}</span>}
          <span>{t.open} → {t.close}</span>
          {t.days != null && <span>{t.days}d</span>}
          {t.kept && t.kept !== "—" && <span>{t.kept} kept</span>}
        </div>
      </div>
    );
  };

  const expiringCard = (p, key) => {
    const tc = TYPE_COLORS[p.type] || {};
    return (
      <div key={key} style={{ background: theme.bg.elevated, border: `1px solid ${theme.border.default}`, borderRadius: theme.radius.md, padding: `${theme.space[2]}px ${theme.space[3]}px` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[1] }}>
          <div style={{ display: "flex", alignItems: "center", gap: theme.space[2] }}>
            <span style={{ fontWeight: 700, color: theme.text.primary, fontSize: theme.size.md }}>{p.ticker}</span>
            <span style={{ background: tc.bg, color: tc.text, padding: `2px ${theme.space[2]}px`, borderRadius: theme.radius.sm, fontSize: theme.size.sm, fontWeight: 500 }}>{p.type}</span>
            <span style={{ color: theme.blue, fontSize: theme.size.sm }}>Expires {formatExpiry(p.expiry_date)}</span>
          </div>
          <span style={{ fontWeight: 600, color: theme.green, fontSize: theme.size.md }}>{formatDollarsFull(p.premium_collected)}</span>
        </div>
        <div style={{ display: "flex", gap: theme.space[3], fontSize: theme.size.sm, color: theme.text.muted, flexWrap: "wrap" }}>
          {p.strike && <span>${p.strike}</span>}
          {p.open_date && <span>opened {p.open_date.slice(5).replace("-", "/")}</span>}
        </div>
      </div>
    );
  };

  const groupHeaderCard = (g) => (
    <div key={`grp-${g.ticker}`} style={{ display: "flex", alignItems: "center", gap: theme.space[2], padding: `${theme.space[1]}px ${theme.space[1]}px`, marginTop: theme.space[1] }}>
      <span style={{ fontWeight: 700, color: theme.text.primary, fontSize: theme.size.sm }}>{g.ticker}</span>
      <span style={{ color: theme.text.subtle, fontSize: theme.size.xs }}>{g.count} row{g.count !== 1 ? "s" : ""}</span>
      <span style={{ color: g.premium >= 0 ? theme.green : theme.red, fontSize: theme.size.xs, fontWeight: 600 }}>{formatDollarsFull(g.premium)}</span>
    </div>
  );

  const closedExpiringDivider = displayClosed.length > 0 && displayExpiring.length > 0;

  return (
    <div style={{ marginTop: theme.space[4], padding: `${theme.space[5]}px`, background: theme.bg.surface, borderRadius: theme.radius.md, border: `1px solid ${theme.border.default}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space[3] }}>
        <div style={{ fontSize: theme.size.md, fontWeight: 600, color: theme.text.primary }}>
          {selectedDay
            ? new Date(selectedDay + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
            : selectedWeek != null
              ? `Week ${selectedWeek + 1} — ${MONTHS[calMonth].label} 2026`
              : `${MONTHS[calMonth].label} 2026 — All Transactions`}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: theme.space[3] }}>
          {selectedDay && displayClosed.length > 0 && dailyData[selectedDay] && (
            <div style={{ fontSize: theme.size.md, fontWeight: 600, color: dailyData[selectedDay].premium >= 0 ? theme.green : theme.red }}>
              {formatDollarsFull(dailyData[selectedDay].premium)} · {displayClosed.length} trade{displayClosed.length !== 1 ? "s" : ""}
            </div>
          )}
          {selectedWeek != null && displayClosed.length > 0 && (() => {
            const weekTotal = weeklyTotals[selectedWeek].total;
            return (
              <div style={{ fontSize: theme.size.md, fontWeight: 600, color: weekTotal >= 0 ? theme.green : theme.red }}>
                {formatDollarsFull(weekTotal)} · {displayClosed.length} trade{displayClosed.length !== 1 ? "s" : ""}
              </div>
            );
          })()}
          <button
            onClick={() => setGroupByTicker(v => !v)}
            title="Group rows by ticker"
            style={{
              fontSize: theme.size.xs,
              fontWeight: 500,
              padding: `${theme.space[1]}px ${theme.space[2]}px`,
              borderRadius: theme.radius.pill,
              cursor: "pointer",
              whiteSpace: "nowrap",
              border: `1px solid ${groupByTicker ? theme.blue : theme.border.default}`,
              background: "transparent",
              color: groupByTicker ? theme.blue : theme.text.muted,
            }}
          >
            Group by ticker
          </button>
        </div>
      </div>

      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.space[2] }}>
          {groups
            ? groups.map((g) => (
                <Fragment key={g.ticker}>
                  {groupHeaderCard(g)}
                  {g.closed.map((t, i) => closedCard(t, `${g.ticker}-closed-${i}`))}
                  {g.expiring.map((p, i) => expiringCard(p, `${g.ticker}-expiry-${i}`))}
                </Fragment>
              ))
            : (
              <>
                {orderRows(displayClosed).map((t, i) => closedCard(t, `closed-${i}`))}
                {closedExpiringDivider && (
                  <div style={{ textAlign: "center", fontSize: theme.size.sm, color: theme.text.subtle, padding: `${theme.space[1]}px 0` }}>── Open positions expiring ──</div>
                )}
                {orderRows(displayExpiring).map((p, i) => expiringCard(p, `expiry-${i}`))}
              </>
            )}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.size.md }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.border.strong}` }}>
                {COLS.map((c, idx) => {
                  const active = sort && sort.key === c.key;
                  return (
                    <th
                      key={idx}
                      onClick={c.key ? () => toggleSort(c.key) : undefined}
                      style={{
                        padding: theme.space[2],
                        textAlign: "left",
                        color: active ? theme.text.secondary : theme.text.muted,
                        fontWeight: 500,
                        fontSize: theme.size.xs,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        whiteSpace: "nowrap",
                        cursor: c.key ? "pointer" : "default",
                        userSelect: "none",
                      }}
                    >
                      {c.label}{active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {groups
                ? groups.map((g) => (
                    <Fragment key={g.ticker}>
                      {groupHeaderRow(g)}
                      {g.closed.map((t, i) => closedRow(t, `${g.ticker}-closed-${i}`))}
                      {g.expiring.map((p, i) => expiringRow(p, `${g.ticker}-expiry-${i}`))}
                    </Fragment>
                  ))
                : (
                  <>
                    {orderRows(displayClosed).map((t, i) => closedRow(t, `closed-${i}`))}
                    {closedExpiringDivider && (
                      <tr>
                        <td colSpan={12} style={{ padding: theme.space[2], textAlign: "center", fontSize: theme.size.sm, color: theme.text.subtle, borderTop: `1px solid ${theme.border.default}`, borderBottom: `1px solid ${theme.border.default}` }}>
                          ── Open positions expiring ──
                        </td>
                      </tr>
                    )}
                    {orderRows(displayExpiring).map((p, i) => expiringRow(p, `expiry-${i}`))}
                  </>
                )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
