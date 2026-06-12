// Cohort resolution + math for the CSP cohorts feature. A cohort is the set of
// positions whose journal entries carry a `cohort:<slug>` tag; members are
// tuple-matched against open positions and closed trades so they keep
// resolving after close. See docs/superpowers/specs/2026-06-11-csp-cohorts-design.md.

import { tupleMatch } from "./strategyBasket";

export function slugifyCohortName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toIsoDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v);
}

function memberFromOpen(pos) {
  return {
    status: "open",
    ticker: pos.ticker,
    type: pos.type,
    strike: pos.strike ?? null,
    expiry: pos.expiry_date ?? null,
    openDate: pos.open_date ?? null,
    closeDate: null,
    contracts: pos.contracts ?? null,
    premiumCollected: pos.premium_collected ?? 0,
    keptPct: null,
  };
}

// Accepts raw DB trade rows and normalizeTrade() output (premium_collected→premium).
function memberFromTrade(trade) {
  return {
    status: "closed",
    ticker: trade.ticker,
    type: trade.type,
    strike: trade.strike ?? null,
    expiry: trade.expiry_date ?? null,
    openDate: trade.open_date ?? null,
    closeDate: toIsoDate(trade.close_date ?? trade.closeDate) ?? null,
    contracts: trade.contracts ?? null,
    premiumCollected: trade.premium_collected ?? trade.premium ?? 0,
    keptPct: trade.kept_pct ?? null,
  };
}

function memberKey(m) {
  return `${m.ticker}|${m.type}|${m.strike}|${m.expiry_date ?? m.expiry}`;
}

/**
 * Resolve a cohort tag into members.
 * @returns {{members: Array, unresolved: Array, createdAt: string|null}}
 */
export function resolveCohort(tag, { openPositions = [], trades = [], entries = [] }) {
  const seen = new Set();
  const members = [];
  const unresolved = [];
  let createdAt = null;

  for (const e of entries) {
    if (!Array.isArray(e.tags) || !e.tags.includes(tag)) continue;
    if (e.created_at && (createdAt == null || e.created_at < createdAt)) createdAt = e.created_at;

    const key = memberKey(e);
    if (seen.has(key)) continue;
    seen.add(key);

    const openMatch = openPositions.find(p => tupleMatch(e, p));
    if (openMatch) { members.push(memberFromOpen(openMatch)); continue; }
    const closedMatch = trades.find(t => tupleMatch(e, t));
    if (closedMatch) { members.push(memberFromTrade(closedMatch)); continue; }
    unresolved.push({ ticker: e.ticker, type: e.type, strike: e.strike ?? null, expiry: e.expiry ?? null });
  }

  return { members, unresolved, createdAt };
}
