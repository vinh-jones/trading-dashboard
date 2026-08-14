import { formatExpiry } from "../../lib/format";
import { theme } from "../../lib/theme";

export function getTradeEmoji(trade) {
  const premium = trade.premium ?? 0;
  const subtype = trade.subtype;
  const keptPct = trade.kept && trade.kept !== "—" ? parseFloat(trade.kept) / 100 : null;
  const days    = trade.days;
  const type    = trade.type;

  if (premium < 0)                                         return "🔴";
  if (subtype === "Assigned")                              return "📌";
  if (subtype === "Expired")                               return "💨";
  if (keptPct != null && keptPct >= 0.80 && days <= 7)    return "⚡";
  if (keptPct != null && keptPct >= 0.80)                  return "🎯";
  if (keptPct != null && keptPct >= 0.60 && days <= 3)    return "⚡";
  if (keptPct != null && keptPct >= 0.60)                  return "✅";
  if (keptPct != null && keptPct >= 0.40)                  return "🟡";
  if (keptPct != null && keptPct < 0.40 && premium > 0)   return "🏃";
  if (type === "Spread")                                   return "🛡️";
  if (type === "LEAPS")                                    return "🔭";
  if (type === "Shares" && premium > 0)                    return "💰";
  if (type === "Shares" && premium < 0)                    return "💸";
  if (type === "Interest")                                 return "💵";
  return "📋";
}

/**
 * Resolve the trade a journal entry describes.
 *
 * Auto-journaled close entries carry the trade's `trade_id` — always trust it.
 * The title heuristic below can't tell two same-day lots apart (two share lots
 * of the same ticker closed on the same date produce the identical title
 * "Shares — Closed MM/DD"), so without the id it renders whichever lot happens
 * to sort first — the wrong basis and the wrong P&L.
 *
 * Entries with no trade_id (opens, hand-written notes) fall back to matching on
 * ticker + type + strike + date.
 */
export function findLinkedTrade({ entry, trades = [], openTrades = [] }) {
  if (entry.entry_type !== "trade_note" || !entry.ticker) return null;

  if (entry.trade_id) {
    const byId = trades.find(t => t.id === entry.trade_id);
    if (byId) return byId;
  }

  const typeMatch   = entry.title?.match(/^(\w+)/);
  // Only match a strike if it appears directly after the type word (e.g. "LEAPS $230 —")
  // This prevents entry costs like "LEAPS — Opened @ $56.20" from being misread as strikes.
  const strikeMatch = entry.title?.match(/^\w+ \$(\d+(?:\.\d+)?)/);
  const titleType   = typeMatch?.[1];
  const titleStrike = strikeMatch ? parseFloat(strikeMatch[1]) : null;
  const matches = (t) =>
    t.ticker === entry.ticker &&
    (!titleType   || t.type   === titleType) &&
    (!titleStrike || t.strike === titleStrike);

  // When the title explicitly says "— Opened" or "— Closed", route to the
  // correct set directly. This handles same-day rolls where both a close and
  // an open share the same ticker/type/strike — without disambiguation the
  // "Opened" entry would accidentally match the closed trade.
  const isOpenTitle   = /—\s*Opened\b/i.test(entry.title ?? "");
  const isClosedTitle = /—\s*Closed\b/i.test(entry.title ?? "");

  // Closed trades: entry_date = close_date (skip if title says Opened)
  if (!isOpenTitle) {
    const closed = trades.find(t =>
      matches(t) && t.closeDate?.toISOString().slice(0, 10) === entry.entry_date
    );
    if (closed) return closed;
  }
  // Open positions: entry_date = open_date (skip if title says Closed)
  if (!isClosedTitle) {
    return openTrades.find(t =>
      matches(t) && t.open_date === entry.entry_date
    ) ?? null;
  }
  return null;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function journalSinceDate(filter) {
  const d = new Date();
  if (filter === "this_month") return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  if (filter === "last_30")    { d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); }
  if (filter === "last_90")    { d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); }
  return null;
}

export function fmtEntryDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function buildAutoTitle(entryType, linkedPosition, linkedTrade) {
  if (entryType === "eod_update") return `EOD — ${todayISO()}`;
  if (linkedPosition) {
    const p = linkedPosition;
    if (p.type === "CSP")   return `CSP $${p.strike} ${formatExpiry(p.expiry_date)} — Open`;
    if (p.type === "CC")    return `CC $${p.strike} ${formatExpiry(p.expiry_date)} — Active`;
    if (p.type === "LEAPS") return `LEAPS — ${p.description || "Open"}`;
    return `Shares — Open`;
  }
  if (linkedTrade) {
    const t = linkedTrade;
    const strike = t.strike ? ` $${t.strike}` : "";
    return `${t.type}${strike} — Closed ${t.close} (${t.kept})`;
  }
  return "";
}

// Helper: floor status label + color for EOD stinger line
export function eodFloorLabel(status) {
  if (status === "above")  return { text: "↑ ceiling", color: theme.amber };
  if (status === "below")  return { text: "↓ floor",   color: theme.red   };
  if (status === "within") return { text: "✓ in band", color: theme.green };
  return null;
}

// Helper: build activity count label for stinger (e.g. "2 closes", "1 open · 1 close")
export function eodActivityLabel(activity) {
  if (!activity) return null;
  const c = activity.closed?.length ?? 0;
  const o = activity.opened?.length ?? 0;
  if (c === 0 && o === 0) return null;
  const parts = [];
  if (o > 0) parts.push(`${o} open`);
  if (c > 0) parts.push(`${c} close${c !== 1 ? "s" : ""}`);
  return parts.join(" · ");
}
