import { formatExpiry } from "../../lib/format";

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
  if (status === "above") return { text: "↑ ceiling", color: "#e3b341" };
  if (status === "below") return { text: "↓ floor",   color: "#f85149" };
  if (status === "within") return { text: "✓ in band", color: "#3fb950" };
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
