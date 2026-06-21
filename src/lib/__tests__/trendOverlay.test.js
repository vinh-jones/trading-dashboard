import { describe, it, expect } from "vitest";
import { trendOverlay } from "../trendOverlay";

const rd = (state) => ({ redeploy_state: state });

describe("trendOverlay — flow veto on redeploy", () => {
  it("redeploy + bullish flow → let it ride (the headline)", () => {
    const r = trendOverlay(rd("redeploy"), 0.4);
    expect(r.state).toBe("let_it_ride");
    expect(r.overridden).toBe(true);
    expect(r.base).toBe("redeploy");
  });

  it("redeploy + neutral flow → unchanged (still redeploy)", () => {
    expect(trendOverlay(rd("redeploy"), 0.05).state).toBe("redeploy");
    expect(trendOverlay(rd("redeploy"), 0.05).overridden).toBe(false);
  });

  it("redeploy + bearish flow → still redeploy (you're already closing)", () => {
    expect(trendOverlay(rd("redeploy"), -0.5).state).toBe("redeploy");
  });

  it("watch + bullish → hold (lean to keep)", () => {
    expect(trendOverlay(rd("watch"), 0.3).state).toBe("hold");
  });

  it("hold + bearish → shed (defend earlier)", () => {
    const r = trendOverlay(rd("hold"), -0.3);
    expect(r.state).toBe("shed");
    expect(r.overridden).toBe(true);
  });

  it("hold + bullish → unchanged hold", () => {
    expect(trendOverlay(rd("hold"), 0.5).state).toBe("hold");
    expect(trendOverlay(rd("hold"), 0.5).overridden).toBe(false);
  });

  it("underwater is left alone (it's a roll decision)", () => {
    expect(trendOverlay(rd("underwater"), -0.5).state).toBe("underwater");
  });

  it("null/missing flow leaves the base state untouched", () => {
    expect(trendOverlay(rd("redeploy"), null).state).toBe("redeploy");
    expect(trendOverlay(rd("watch"), undefined).overridden).toBe(false);
  });

  it("skipped / missing redeploy → null state", () => {
    expect(trendOverlay({ skipped: "missing_mark" }, 0.5).state).toBeNull();
    expect(trendOverlay(null, 0.5).state).toBeNull();
  });

  it("threshold is configurable", () => {
    expect(trendOverlay(rd("redeploy"), 0.15, { BULLISH: 0.1, BEARISH: -0.1 }).state).toBe("let_it_ride");
  });

  it("confirmedBullish gates let_it_ride (a single print can't extend a hold)", () => {
    expect(trendOverlay(rd("redeploy"), 0.5, undefined, { confirmedBullish: false }).state).toBe("redeploy");
    expect(trendOverlay(rd("redeploy"), 0.5, undefined, { confirmedBullish: true }).state).toBe("let_it_ride");
  });
});
