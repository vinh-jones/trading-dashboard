import { describe, it, expect } from "vitest";
import {
  targetProfitPctForDtePct,
  proximityFraction,
  buildAttentionList,
} from "../positionAttention";

describe("targetProfitPctForDtePct", () => {
  it(">80% DTE left → 50% target", () => {
    expect(targetProfitPctForDtePct(90)).toBe(50);
    expect(targetProfitPctForDtePct(81)).toBe(50);
  });
  it("41–79% DTE left → 60% target", () => {
    expect(targetProfitPctForDtePct(80)).toBe(60);
    expect(targetProfitPctForDtePct(50)).toBe(60);
    expect(targetProfitPctForDtePct(41)).toBe(60);
  });
  it("≤40% DTE left → 80% target", () => {
    expect(targetProfitPctForDtePct(40)).toBe(80);
    expect(targetProfitPctForDtePct(10)).toBe(80);
    expect(targetProfitPctForDtePct(0)).toBe(80);
  });
});

describe("proximityFraction", () => {
  it("clamps negative G/L to 0", () => {
    expect(proximityFraction(-5, 60)).toBe(0);
  });
  it("clamps at 1 when at or past target", () => {
    expect(proximityFraction(60, 60)).toBe(1);
    expect(proximityFraction(75, 60)).toBe(1);
  });
  it("returns ratio between 0 and 1 when approaching", () => {
    expect(proximityFraction(30, 60)).toBe(0.5);
    expect(proximityFraction(45, 60)).toBe(0.75);
  });
  it("returns 0 when target is not positive", () => {
    expect(proximityFraction(10, 0)).toBe(0);
    expect(proximityFraction(10, null)).toBe(0);
  });
});

describe("buildAttentionList", () => {
  const baseCsp = {
    ticker: "NVDA",
    expiry_date: "2026-05-01",
    open_date:   "2026-04-01",
    strike:      450,
    contracts:   1,
    premium_collected: 300,
  };
  const items = [
    { id: "csp-itm-NVDA-450-2026-05-01", priority: "P1", rule: "csp_itm_urgency", ticker: "NVDA", strike: 450, expiry_date: "2026-05-01", title: "NVDA CSP ITM" },
    { id: "60-60-TSLA-450-2026-05-01",   priority: "P2", rule: "rule_60_60",      ticker: "TSLA", strike: 450, expiry_date: "2026-05-01", title: "TSLA 60/60 hit" },
  ];

  it("emits one entry per open position", () => {
    const positions = { open_csps: [baseCsp], open_leaps: [], open_spreads: [], assigned_shares: [] };
    const out = buildAttentionList(positions, new Map(), items);
    expect(out.length).toBe(1);
    expect(out[0].ticker).toBe("NVDA");
  });

  it("attaches matching alerts to the row (by ticker)", () => {
    const positions = { open_csps: [baseCsp, { ...baseCsp, ticker: "TSLA" }], open_leaps: [], open_spreads: [], assigned_shares: [] };
    const out = buildAttentionList(positions, new Map(), items);
    const nvda = out.find(r => r.ticker === "NVDA");
    const tsla = out.find(r => r.ticker === "TSLA");
    expect(nvda.alertTags.map(t => t.priority)).toEqual(["P1"]);
    expect(tsla.alertTags.map(t => t.priority)).toEqual(["P2"]);
  });

  it("derives priority from the highest-priority alert (P1 > P2 > P3 > none)", () => {
    const positions = { open_csps: [baseCsp], open_leaps: [], open_spreads: [], assigned_shares: [] };
    const out = buildAttentionList(positions, new Map(), items);
    expect(out[0].priority).toBe("P1");
  });

  it("sorts rows by priority then by proximity descending then by DTE ascending", () => {
    const low   = { ...baseCsp, ticker: "A", expiry_date: "2026-06-01" };
    const high  = { ...baseCsp, ticker: "B", expiry_date: "2026-04-30" };
    const urgent = { ...baseCsp, ticker: "C", expiry_date: "2026-05-10" };
    const itemsMixed = [
      { id: "expiring-CSP-C-450-2026-05-10", priority: "P1", rule: "expiring_soon", ticker: "C", strike: 450, expiry_date: "2026-05-10", title: "C expiring" },
    ];
    const positions = { open_csps: [low, high, urgent], open_leaps: [], open_spreads: [], assigned_shares: [] };
    const out = buildAttentionList(positions, new Map(), itemsMixed);
    // P1 first (C), then non-alerted sorted by proximity desc then DTE asc.
    expect(out.map(r => r.ticker)[0]).toBe("C");
  });

  it("returns an empty list when positions is null", () => {
    expect(buildAttentionList(null, new Map(), [])).toEqual([]);
  });
});
