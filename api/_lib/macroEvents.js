/**
 * api/_lib/macroEvents.js — pure UW economic-calendar → macro_events rows.
 *
 * No I/O, so the classifier is testable against a captured fixture.
 *
 * UW emits several rows per release: for one CPI print you get "Consumer price
 * index", "Core CPI", "CPI year over year" and "Core CPI year over year". We
 * keep only the headline, one row per (date, type) — that is what the Focus
 * calendar and the macro_overlap rule both want, and it matches the table PK.
 *
 * Matching is an anchored regex on the exact headline name rather than a
 * substring, precisely so the core/YoY variants fall through.
 */

export const MACRO_EVENT_TYPES = ["CPI", "PPI", "NFP", "FOMC", "PCE", "RETAIL_SALES"];

// Order matters only for readability — the names are mutually exclusive.
const TYPE_MATCHERS = [
  { type: "CPI",          re: /^consumer price index$/ },
  { type: "PPI",          re: /^producer price index$/ },
  { type: "NFP",          re: /^u\.s\. employment report$/ },
  { type: "RETAIL_SALES", re: /^u\.s\. retail sales$/ },
  // Not observable in the ~8-day window UW publishes — the fixture coverage
  // test is what guards these. Anchored alternatives cover the plausible
  // UW spellings.
  { type: "PCE",          re: /^(pce index|personal consumption expenditures?( price index)?)$/ },
  { type: "FOMC",         re: /^(fomc announcement|fomc rate decision|fed interest[- ]rate decision)$/ },
];

/** Whitelisted event type for a UW event name, or null. */
export function classifyEvent(name) {
  if (typeof name !== "string") return null;
  const s = name.trim().toLowerCase();
  if (!s) return null;
  for (const { type, re } of TYPE_MATCHERS) {
    if (re.test(s)) return type;
  }
  return null;
}

// Market-facing dates are ET regardless of where the user sits (see CLAUDE.md).
// An 00:30Z release is the previous ET calendar day and must not drift forward.
const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
});

function etDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return ET_DATE.format(d); // en-CA formats as YYYY-MM-DD
}

function str(v) {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

/**
 * UW rows → macro_events rows, deduped to one per (event_date, event_type),
 * keeping the earliest event_time on a tie.
 */
export function normalizeEvents(rows, refreshedAt) {
  const list = Array.isArray(rows) ? rows : Array.isArray(rows?.data) ? rows.data : [];
  const byKey = new Map();

  for (const r of list) {
    const type = classifyEvent(r?.event);
    if (!type) continue;
    const time = r?.time;
    const date = time ? etDate(time) : null;
    if (!date) continue;

    const key = `${date}|${type}`;
    const prev = byKey.get(key);
    if (prev && String(prev.event_time) <= String(time)) continue;

    byKey.set(key, {
      event_date:   date,
      event_type:   type,
      event_time:   time,
      title:        String(r.event).trim(),
      forecast:     str(r?.forecast),
      previous:     str(r?.prev),
      refreshed_at: refreshedAt,
    });
  }

  return [...byKey.values()].sort(
    (a, b) => a.event_date.localeCompare(b.event_date) || a.event_type.localeCompare(b.event_type),
  );
}
