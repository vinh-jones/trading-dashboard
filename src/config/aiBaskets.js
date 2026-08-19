// AI Thesis basket config — aibottlenecks.app "chokepoint" taxonomy mapped to the
// approved wheel universe (wheel_universe.list_type = 'approved').
//
// display: 'on-thesis'    → AI-infrastructure picks-and-shovels; renders a detail card.
// display: 'summary-only' → off-thesis; feeds exposure math only, no card.
//
// Basket names + membership mirror column A of Ryan's "Approved Wheel Stocks FINAL
// OTU (Aug 2026)" sheet 1:1, so a future list update is a straight copy. The sheet
// carries no on-thesis flag — that split is ours: the AI chokepoint groups render
// cards, the broad/commodity/consumer groups feed exposure math only.
//
// INVARIANT: every approved ticker appears in exactly one basket. The drift guard in
// src/config/__tests__/aiBaskets.test.js fails CI if this and the universe diverge —
// when Ryan changes the approved list, update migration + APPROVED_UNIVERSE + this file
// together.

export const AI_BASKETS = [
  // ── ON-THESIS (render detail cards) ───────────────────────────────
  { id: "custom-silicon",          name: "Custom silicon",           display: "on-thesis", tickers: ["AMD", "AVGO", "NVDA", "INTC"] },
  { id: "lithography-fab",         name: "Lithography & fab tools",  display: "on-thesis", tickers: ["TSM", "AMAT", "LRCX", "KLAC"] },
  { id: "memory-supercycle",       name: "Memory supercycle",        display: "on-thesis", tickers: ["MU", "DRAM"] },
  { id: "hbm-packaging",           name: "HBM / packaging",          display: "on-thesis", tickers: ["GLW", "TER"] },
  { id: "photonics-cpo",           name: "Photonics / CPO",          display: "on-thesis", tickers: ["COHR", "LYTE"] },
  { id: "networking-retimers",     name: "Networking / retimers",    display: "on-thesis", tickers: ["CRDO", "ANET", "CSCO"] },
  { id: "connectors-interconnect", name: "Connectors & interconnect",display: "on-thesis", tickers: ["APH"] },
  { id: "storage",                 name: "Storage",                  display: "on-thesis", tickers: ["WDC", "STX"] },
  { id: "cooling",                 name: "Cooling",                  display: "on-thesis", tickers: ["VRT"] },
  { id: "power-grid",              name: "Power & grid",             display: "on-thesis", tickers: ["CEG", "ADI", "BE"] },
  { id: "ai-cloud-neoclouds",      name: "AI cloud / neoclouds",     display: "on-thesis", tickers: ["CLS", "IREN", "NBIS", "DELL"] },

  // ── SUMMARY-ONLY (off-thesis exposure math; no detail card) ───────
  { id: "software-platforms",      name: "Software & platforms",     display: "summary-only", tickers: ["PLTR", "SHOP", "FTNT", "INOD", "META", "APP", "MSFT", "AAPL", "GOOGL", "AMZN"] },
  { id: "financials-fintech",      name: "Financials & fintech",     display: "summary-only", tickers: ["FUTU", "HOOD", "AXP", "JPM", "SOFI"] },
  { id: "crypto",                  name: "Crypto",                   display: "summary-only", tickers: ["IBIT", "ETHA"] },
  { id: "materials-mining-energy", name: "Materials, mining & energy", display: "summary-only", tickers: ["CCJ", "CDE", "AA", "HL", "EQT", "NEM", "FCX"] },
  { id: "industrials-defense",     name: "Industrials & defense",    display: "summary-only", tickers: ["KTOS", "GE", "CAT", "RTX"] },
  { id: "ev-consumer-travel",      name: "EV / consumer / travel",   display: "summary-only", tickers: ["TSLA", "CCL"] },
  { id: "broad-etf",               name: "Broad ETF",                display: "summary-only", tickers: ["SMH"] },
];

export const ON_THESIS_BASKETS  = AI_BASKETS.filter(b => b.display === "on-thesis");
export const OFF_THESIS_BASKETS = AI_BASKETS.filter(b => b.display === "summary-only");

/** Flat list of every ticker across all baskets. */
export const ALL_BASKET_TICKERS = AI_BASKETS.flatMap(b => b.tickers);
