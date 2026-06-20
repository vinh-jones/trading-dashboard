import { describe, it, expect } from "vitest";
import { gammaEnvFromGreek, flowSentimentFromAlerts, whalePutSellsFromAlerts } from "../uwNormalize";

// Real get_greek_exposure_by_ticker shape (NVDA, trimmed to 2 days).
const greekRows = [
  { date: "2026-06-17", call_gamma: "6736274.6313", put_gamma: "-3815125.8349" },
  { date: "2026-06-18", call_gamma: "6390313.6682", put_gamma: "-3610537.7762" },
];

describe("gammaEnvFromGreek", () => {
  it("uses the latest day's net/gross gamma ratio in [-1,1]", () => {
    // (6390313.67 - 3610537.78) / (6390313.67 + 3610537.78) = 0.27795
    expect(gammaEnvFromGreek(greekRows)).toBeCloseTo(0.27795, 4);
  });
  it("is positive when call gamma dominates (stable env)", () => {
    expect(gammaEnvFromGreek(greekRows)).toBeGreaterThan(0);
  });
  it("negative when put gamma dominates", () => {
    expect(gammaEnvFromGreek([{ call_gamma: "1000", put_gamma: "-3000" }])).toBeCloseTo(-0.5, 5);
  });
  it("null on empty / unusable input", () => {
    expect(gammaEnvFromGreek([])).toBeNull();
    expect(gammaEnvFromGreek(null)).toBeNull();
    expect(gammaEnvFromGreek([{ call_gamma: "0", put_gamma: "0" }])).toBeNull();
  });
});

describe("flowSentimentFromAlerts", () => {
  it("bid-side puts only → fully bullish (+1)", () => {
    const alerts = [
      { type: "put", total_bid_side_prem: "4286740", total_ask_side_prem: "0" },
      { type: "put", total_bid_side_prem: "156800",  total_ask_side_prem: "0" },
    ];
    expect(flowSentimentFromAlerts(alerts)).toBeCloseTo(1, 5);
  });
  it("nets puts-sold + calls-bought (bull) vs puts-bought + calls-sold (bear)", () => {
    const alerts = [
      { type: "put",  total_bid_side_prem: "100", total_ask_side_prem: "50" }, // +100 / -50
      { type: "call", total_bid_side_prem: "20",  total_ask_side_prem: "30" }, // +30 / -20
    ];
    // bullish 130, bearish 70 → (130-70)/200 = 0.30
    expect(flowSentimentFromAlerts(alerts)).toBeCloseTo(0.30, 5);
  });
  it("null when empty or no premium", () => {
    expect(flowSentimentFromAlerts([])).toBeNull();
    expect(flowSentimentFromAlerts([{ type: "put", total_bid_side_prem: "0", total_ask_side_prem: "0" }])).toBeNull();
  });
});

describe("whalePutSellsFromAlerts", () => {
  const alerts = [
    { ticker: "NVDA", type: "put", strike: "215", expiry: "2027-01-15", total_bid_side_prem: "4286740", total_ask_side_prem: "0", total_size: 1576, has_sweep: false, alert_rule: "RepeatedHitsAscendingFill", underlying_price: "210.95", next_earnings_date: "2026-08-26" },
    { ticker: "NVDA", type: "put", strike: "175", expiry: "2027-01-15", total_bid_side_prem: "1702684", total_ask_side_prem: "229770", total_size: 1867, has_sweep: false, alert_rule: "RepeatedHitsAscendingFill", underlying_price: "210.77", next_earnings_date: "2026-08-26" },
    { ticker: "NVDA", type: "call", strike: "230", expiry: "2026-07-17", total_bid_side_prem: "900000", total_ask_side_prem: "0" }, // call → excluded
    { ticker: "NVDA", type: "put", strike: "200", expiry: "2026-07-17", total_bid_side_prem: "10000", total_ask_side_prem: "0" }, // below min → excluded
  ];
  it("keeps bid-dominant puts over the premium floor, sorted desc", () => {
    const r = whalePutSellsFromAlerts(alerts, 50000);
    expect(r.map((x) => x.strike)).toEqual([215, 175]);
    expect(r[0].premium).toBe(4286740);
    expect(r[0].next_earnings).toBe("2026-08-26");
  });
  it("excludes calls and sub-floor sizes", () => {
    const r = whalePutSellsFromAlerts(alerts, 50000);
    expect(r.every((x) => x.strike !== 230 && x.strike !== 200)).toBe(true);
  });
});
