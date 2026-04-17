// Pure helpers for grouping journal entries by week + day.
// Week boundaries are Sunday–Saturday, computed in browser-local time.

function parseLocalDate(iso) {
  return new Date(iso + "T00:00:00");
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sundayOfWeek(d) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function groupByWeek(entries) {
  if (!entries || entries.length === 0) return [];

  const weekMap = new Map();

  for (const entry of entries) {
    const date      = parseLocalDate(entry.entry_date);
    const weekStart = sundayOfWeek(date);
    const weekEnd   = addDays(weekStart, 6);
    const weekKey   = toISODate(weekStart);

    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, {
        weekStart: weekKey,
        weekEnd:   toISODate(weekEnd),
        dayMap:    new Map(),
      });
    }
    const week = weekMap.get(weekKey);

    const dayKey = entry.entry_date;
    if (!week.dayMap.has(dayKey)) {
      week.dayMap.set(dayKey, { date: dayKey, entries: [] });
    }
    week.dayMap.get(dayKey).entries.push(entry);
  }

  const weeks = [...weekMap.values()].sort((a, b) => b.weekStart.localeCompare(a.weekStart));

  return weeks.map(w => ({
    weekStart: w.weekStart,
    weekEnd:   w.weekEnd,
    days:      [...w.dayMap.values()].sort((a, b) => b.date.localeCompare(a.date)),
  }));
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function weekLabel(weekStartISO, todayISO) {
  const todaySunday   = sundayOfWeek(parseLocalDate(todayISO));
  const thisWeekStart = toISODate(todaySunday);

  if (weekStartISO === thisWeekStart) return "This Week";

  const lastWeekStart = toISODate(addDays(todaySunday, -7));
  if (weekStartISO === lastWeekStart) return "Last Week";

  const twoWeeksAgoStart = toISODate(addDays(todaySunday, -14));
  if (weekStartISO === twoWeeksAgoStart) return "2 weeks ago";

  const d = parseLocalDate(weekStartISO);
  return `Week of ${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
}
