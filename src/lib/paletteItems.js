// Pinned actions are always present and always sorted before position results.
// Each item has a stable `id` so React keys don't collide across rebuilds.
const PINNED_ACTIONS = [
  { id: "action:open_journal",   kind: "action", title: "Open Journal",              subtitle: "Review → Journal",                        action: "open_journal",   pinned: true },
  { id: "action:new_eod_entry",  kind: "action", title: "New EOD entry",             subtitle: "Review → Journal · opens EOD form",       action: "new_eod_entry",  pinned: true },
  { id: "action:open_radar",     kind: "action", title: "Open Radar",                subtitle: "Explore → Radar",                         action: "open_radar",     pinned: true },
  { id: "action:open_macro",     kind: "action", title: "Open Macro summary",        subtitle: "Explore → Macro",                         action: "open_macro",     pinned: true },
];

function cspItems(positions) {
  return (positions?.open_csps || []).map(p => ({
    id:       `pos:csp:${p.ticker}:${p.strike}:${p.expiry_date}`,
    kind:     "position",
    title:    `${p.ticker} CSP $${p.strike}`,
    subtitle: p.expiry_date ? `exp ${p.expiry_date}` : undefined,
    action:   "open_position",
    payload:  { ticker: p.ticker, type: "CSP", position: p },
  }));
}

function ccItems(positions) {
  const rows = [];
  for (const s of (positions?.assigned_shares || [])) {
    if (!s.active_cc) continue;
    rows.push({
      id:       `pos:cc:${s.ticker}:${s.active_cc.strike}:${s.active_cc.expiry_date}`,
      kind:     "position",
      title:    `${s.ticker} CC $${s.active_cc.strike}`,
      subtitle: s.active_cc.expiry_date ? `exp ${s.active_cc.expiry_date}` : undefined,
      action:   "open_position",
      payload:  { ticker: s.ticker, type: "CC", position: { ...s.active_cc, ticker: s.ticker } },
    });
  }
  return rows;
}

function leapItems(positions) {
  const top = (positions?.open_leaps || []).map(l => ({
    id:       `pos:leap:${l.ticker}:${l.strike}:${l.expiry_date}`,
    kind:     "position",
    title:    `${l.ticker} LEAP $${l.strike}`,
    subtitle: l.expiry_date ? `exp ${l.expiry_date}` : undefined,
    action:   "open_position",
    payload:  { ticker: l.ticker, type: "LEAP", position: l },
  }));
  const nested = [];
  for (const s of (positions?.assigned_shares || [])) {
    for (const l of (s.open_leaps || [])) {
      const ticker = l.ticker ?? s.ticker;
      nested.push({
        id:       `pos:leap:${ticker}:${l.strike}:${l.expiry_date}`,
        kind:     "position",
        title:    `${ticker} LEAP $${l.strike}`,
        subtitle: l.expiry_date ? `exp ${l.expiry_date}` : undefined,
        action:   "open_position",
        payload:  { ticker, type: "LEAP", position: { ...l, ticker } },
      });
    }
  }
  return [...top, ...nested];
}

export function buildPaletteItems({ positions }) {
  return [
    ...PINNED_ACTIONS,
    ...cspItems(positions),
    ...ccItems(positions),
    ...leapItems(positions),
  ];
}

// AND-match: every whitespace-separated token must appear in title or subtitle.
// Empty / whitespace query returns all items unchanged.
export function filterPaletteItems(items, query) {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return items;
  const tokens = q.split(/\s+/).filter(Boolean);
  return items.filter(it => {
    const hay = `${it.title} ${it.subtitle ?? ""}`.toLowerCase();
    return tokens.every(t => hay.includes(t));
  });
}
