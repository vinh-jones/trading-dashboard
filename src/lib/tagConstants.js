// Controlled-vocabulary tag system — category colors + ordering.
// Colors are inline hex (no Tailwind). Opacity variants kept subtle for dark theme.

export const CATEGORY_COLORS = {
  'earnings-play':   { bg: 'rgba(20,184,166,0.15)',  border: 'rgba(20,184,166,0.35)',  text: '#2dd4bf' },
  'drift':           { bg: 'rgba(245,158,11,0.15)',  border: 'rgba(245,158,11,0.35)',  text: '#fcd34d' },
  'framework':       { bg: 'rgba(59,130,246,0.15)',  border: 'rgba(59,130,246,0.35)',  text: '#93c5fd' },
  'macro':           { bg: 'rgba(168,85,247,0.15)',  border: 'rgba(168,85,247,0.35)',  text: '#d8b4fe' },
  'signal':          { bg: 'rgba(34,197,94,0.15)',   border: 'rgba(34,197,94,0.35)',   text: '#86efac' },
  'position-action': { bg: 'rgba(107,114,128,0.15)', border: 'rgba(107,114,128,0.35)', text: '#d1d5db' },
  'custom':          { bg: 'rgba(100,116,139,0.15)', border: 'rgba(148,163,184,0.30)', text: '#cbd5e1', dashed: true },
};

export const CATEGORY_ORDER = [
  'earnings-play', 'drift', 'framework', 'macro', 'signal', 'position-action',
];

export function categoryFromTag(tag) {
  const prefix = tag?.split(':')[0] ?? '';
  return CATEGORY_COLORS[prefix] ? prefix : 'custom';
}
