// ── Sector groups ─────────────────────────────────────────────────────────────
// Static definition — sector strings must match exactly what's in wheel_universe.sector.
// Group names are stored in preset filters (e.g. sectors_exclude: ["Tech & AI"]).
// Expanded to sector strings at filter application time via expandGroupsToSectors().

export const SECTOR_GROUPS = {
  'Tech & AI': {
    sectors: [
      'Technology', 'Tech / Data', 'Tech Infra', 'Ecommerce',
      'Networking', 'Cybersecurity', 'Advertising/Social Media/Ai',
      'Search / Cloud', 'Consumer Cloud', 'Enterprise Software / CRM',
      'Tech/Cloud Infrastructure', 'AI Infrastructure / Cloud Technology',
    ],
    tickers: ['MSFT', 'AAPL', 'GOOGL', 'AMZN', 'META', 'PLTR', 'SHOP', 'DELL', 'CSCO', 'FTNT', 'ANET', 'INOD', 'VRT', 'NBIS'],
  },
  'Semiconductors': {
    sectors: [
      'Semiconductors', 'AI / Semiconductors', 'Computer Technology',
      'Electronic Components - Semi', 'Photonics - Semiconductor',
      'Industrial Machinery', 'AI - Memory',
    ],
    tickers: ['AMD', 'NVDA', 'AVGO', 'MU', 'ADI', 'AMAT', 'LRCX', 'APH', 'CRDO', 'COHR', 'TSM', 'WDC', 'STX', 'DRAM', 'SMH', 'INTC'],
  },
  'Financials': {
    sectors: [
      'Financials', 'Financials/Crypto Exchange',
      'Financials/Credit Services', 'Banking',
    ],
    tickers: ['HOOD', 'SOFI', 'NU', 'FUTU', 'TIGR', 'AXP', 'JPM'],
  },
  'Energy': {
    sectors: ['Energy / Oil & Gas', 'Natural Gas', 'Energy'],
    tickers: ['XOM', 'EQT', 'CEG'],
  },
  'Materials/Mining': {
    sectors: [
      'Aluminum', 'Precious Metals - Silver',
      'Precious Metals - copper, gold', 'Precious Metals',
      'Gold & Silver Miner', 'Mining',
    ],
    tickers: ['AA', 'HL', 'FCX', 'NEM', 'CDE', 'CCJ'],
  },
  'Industrials': {
    sectors: ['Industrials', 'Electronics Mfg', 'Technology & Transportation'],
    tickers: ['GE', 'CLS', 'UBER'],
  },
  'Defense': {
    sectors: ['Aerospace & Defense', 'Industrials / Defense'],
    tickers: ['KTOS', 'RTX', 'LMT'],
  },
  'Consumer': {
    sectors: [
      'Consumer Discretionary / Restaurants',
      'Consumer Staples / Household Products', 'Cruise Lines',
    ],
    tickers: ['MCD', 'PG', 'CCL'],
  },
  'Crypto': {
    sectors: ['Crypto Currency', 'Bitcoin Mining/AI Cloud'],
    tickers: ['IBIT', 'ETHA', 'IREN'],
  },
  'Healthcare': {
    sectors: ['Healthcare', 'Biotech', 'Pharmaceuticals', 'Medical Devices'],
    tickers: [],
  },
};

// ── Default filter state ───────────────────────────────────────────────────────

export const DEFAULT_FILTERS = {
  bb_position_min:  null,
  bb_position_max:  null,
  raw_iv_min:       null,
  raw_iv_max:       null,
  composite_iv_min: null,
  composite_iv_max: null,
  iv_rank_min:      null,
  iv_rank_max:      null,
  // Chip-signal allow-sets — empty = not filtered; non-empty = row's bucket must be a member.
  trend_states:     [],
  rsi_buckets:      [],
  score_buckets:    [],
  gex_envs:         [],
  iv_trend_states:  [],
  pe_min:           null,
  pe_max:           null,
  sectors_include:  [],
  sectors_exclude:  [],
  earnings_days_min: null,
  ownership:        'all',
};

// ── Chip-signal filter options ────────────────────────────────────────────────
// value = the exact bucket string produced at runtime (getTrendState().state,
// rsiBucket(), scoreLabel(), quotes.gex_env, ivTrend.state). Do not rename values.
export const TREND_FILTER_OPTIONS = [
  ["uptrend", "Uptrend"], ["pullback", "Pullback"],
  ["recovering", "Recovering"], ["downtrend", "Downtrend"],
];
export const RSI_FILTER_OPTIONS = [
  ["oversold", "Oversold"], ["neutral", "Neutral"], ["overbought", "Overbought"],
];
export const SCORE_FILTER_OPTIONS = [
  ["Strong", "Strong"], ["Moderate", "Moderate"], ["Neutral", "Neutral"], ["Weak", "Weak"],
];
export const GEX_FILTER_OPTIONS = [
  ["stabilized", "Stable"], ["choppy", "Choppy"], ["neutral", "Neutral"],
];
export const IV_TREND_FILTER_OPTIONS = [
  ["rising", "Rising"], ["spiking", "Spiking"], ["falling", "Falling"],
  ["collapsing", "Collapsing"], ["stable", "Stable"],
];

// Maps a filter field → its option list, for generic summary/labeling.
const ALLOW_SET_FIELDS = [
  ["trend_states",    "Trend", TREND_FILTER_OPTIONS],
  ["rsi_buckets",     "RSI",   RSI_FILTER_OPTIONS],
  ["score_buckets",   "Score", SCORE_FILTER_OPTIONS],
  ["gex_envs",        "GEX",   GEX_FILTER_OPTIONS],
  ["iv_trend_states", "IV Trend", IV_TREND_FILTER_OPTIONS],
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Count how many filter dimensions are actively set */
export function countActiveFilters(filters) {
  let count = 0;
  const numericFields = [
    'bb_position_min', 'bb_position_max',
    'raw_iv_min',      'raw_iv_max',
    'composite_iv_min','composite_iv_max',
    'iv_rank_min',     'iv_rank_max',
    'pe_min',          'pe_max',
    'earnings_days_min',
  ];
  numericFields.forEach(f => { if (filters[f] !== null) count++; });
  if (filters.sectors_include?.length > 0) count++;
  if (filters.sectors_exclude?.length > 0) count++;
  if (filters.ownership !== 'all') count++;
  ALLOW_SET_FIELDS.forEach(([field]) => {
    if (filters[field]?.length > 0) count++;
  });
  return count;
}

/** Expand an array of group names → flat array of sector strings */
export function expandGroupsToSectors(groupNames) {
  if (!groupNames?.length) return [];
  return groupNames.flatMap(name => SECTOR_GROUPS[name]?.sectors ?? []);
}

/** Human-readable summary lines for a filter config (used in preset save modal) */
export function filterSummaryLines(filters) {
  const lines = [];
  if (filters.bb_position_min !== null) lines.push(`BB min: ${filters.bb_position_min}`);
  if (filters.bb_position_max !== null) lines.push(`BB max: ${filters.bb_position_max}`);
  if (filters.raw_iv_min      !== null) lines.push(`Raw IV min: ${Math.round(filters.raw_iv_min * 100)}%`);
  if (filters.raw_iv_max      !== null) lines.push(`Raw IV max: ${Math.round(filters.raw_iv_max * 100)}%`);
  if (filters.composite_iv_min !== null) lines.push(`Composite IV min: ${filters.composite_iv_min}`);
  if (filters.composite_iv_max !== null) lines.push(`Composite IV max: ${filters.composite_iv_max}`);
  if (filters.iv_rank_min     !== null) lines.push(`IV Rank min: ${filters.iv_rank_min}`);
  if (filters.iv_rank_max     !== null) lines.push(`IV Rank max: ${filters.iv_rank_max}`);
  if (filters.sectors_include?.length > 0) lines.push(`Include sectors: ${filters.sectors_include.join(', ')}`);
  if (filters.sectors_exclude?.length > 0) lines.push(`Exclude sectors: ${filters.sectors_exclude.join(', ')}`);
  if (filters.pe_min           !== null) lines.push(`P/E min: ${filters.pe_min}`);
  if (filters.pe_max           !== null) lines.push(`P/E max: ${filters.pe_max}`);
  if (filters.earnings_days_min !== null) lines.push(`Earnings > ${filters.earnings_days_min} days away`);
  if (filters.ownership !== 'all') lines.push(`Ownership: ${filters.ownership === 'not_held' ? 'Not held' : 'Held'}`);
  ALLOW_SET_FIELDS.forEach(([field, label, options]) => {
    const vals = filters[field] ?? [];
    if (vals.length > 0) {
      const labelFor = v => (options.find(o => o[0] === v)?.[1]) ?? v;
      lines.push(`${label}: ${vals.map(labelFor).join(", ")}`);
    }
  });
  return lines;
}
