// AI Thesis basket config — aibottlenecks.app "chokepoint" taxonomy mapped to the
// approved wheel universe (wheel_universe.list_type = 'approved').
//
// display: 'on-thesis'    → AI-infrastructure picks-and-shovels; renders a detail card.
// display: 'summary-only' → off-thesis; feeds exposure math only, no card.
//
// INVARIANT: every approved ticker appears in exactly one basket. The drift guard in
// src/config/__tests__/aiBaskets.test.js fails CI if this and the universe diverge —
// when Ryan changes the approved list, update migration + APPROVED_UNIVERSE + this file
// together.

export const AI_BASKETS = [
  // ── ON-THESIS (render detail cards) ───────────────────────────────
  { id: "networking-optics",   name: "Networking & optics",     display: "on-thesis", tickers: ["CRDO", "ANET", "CSCO", "APH"] },
  { id: "ai-picks-datacenter", name: "AI picks / datacenter",   display: "on-thesis", tickers: ["DELL", "CLS", "SMH"] },
  { id: "power-grid",          name: "Power & grid",            display: "on-thesis", tickers: ["CCJ", "EQT", "FCX", "CEG"] },
  { id: "materials-optics",    name: "Materials / optics",      display: "on-thesis", tickers: ["GLW", "COHR"] },
  { id: "hbm-packaging",       name: "HBM packaging",           display: "on-thesis", tickers: ["MU", "DRAM"] },
  { id: "storage",             name: "Storage",                 display: "on-thesis", tickers: ["WDC", "STX"] },
  { id: "custom-silicon",      name: "Custom silicon",          display: "on-thesis", tickers: ["NVDA", "AMD", "AVGO", "TSM", "ADI", "INTC"] },
  { id: "lithography-fab",     name: "Lithography & fab tools", display: "on-thesis", tickers: ["AMAT", "LRCX"] },
  { id: "power-cooling",       name: "Power & cooling",         display: "on-thesis", tickers: ["VRT"] },
  { id: "ai-cloud-neoclouds",  name: "AI cloud / neoclouds",    display: "on-thesis", tickers: ["IREN", "NBIS"] },

  // ── SUMMARY-ONLY (off-thesis exposure math; no detail card) ───────
  { id: "software-platforms",  name: "Software & platforms",     display: "summary-only", tickers: ["PLTR", "SHOP", "FTNT", "INOD", "META", "APP", "MSFT", "AAPL", "GOOGL", "AMZN"] },
  { id: "financials-fintech",  name: "Financials & fintech",     display: "summary-only", tickers: ["FUTU", "HOOD", "AXP", "JPM", "SOFI"] },
  { id: "precious-metals",     name: "Precious metals & mining", display: "summary-only", tickers: ["CDE", "AA", "HL", "NEM"] },
  { id: "industrials-defense", name: "Industrials & defense",    display: "summary-only", tickers: ["KTOS", "GE", "CAT", "RTX"] },
  { id: "crypto-other",        name: "Crypto & other",           display: "summary-only", tickers: ["IBIT", "ETHA", "TSLA", "CCL"] },
];

export const ON_THESIS_BASKETS  = AI_BASKETS.filter(b => b.display === "on-thesis");
export const OFF_THESIS_BASKETS = AI_BASKETS.filter(b => b.display === "summary-only");

/** Flat list of every ticker across all baskets. */
export const ALL_BASKET_TICKERS = AI_BASKETS.flatMap(b => b.tickers);
