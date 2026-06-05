import { describe, it, expect } from "vitest";
import { MODES, EXPLORE_SUBVIEWS, REVIEW_SUBVIEWS, SUBVIEW_LABELS, defaultSubView, isValidMode, isValidSubView } from "../modes";

describe("modes", () => {
  it("exposes the three top-level modes", () => {
    expect(MODES).toEqual(["focus", "explore", "review"]);
  });

  it("exposes Explore sub-views in order", () => {
    expect(EXPLORE_SUBVIEWS).toEqual(["positions", "tickers", "radar", "ai-thesis", "earnings", "macro", "baskets"]);
  });

  it("exposes Review sub-views in order with Journal first", () => {
    expect(REVIEW_SUBVIEWS).toEqual(["journal", "monthly", "history"]);
  });

  it("returns the default sub-view for each mode", () => {
    expect(defaultSubView("focus")).toBe(null);
    expect(defaultSubView("explore")).toBe("positions");
    expect(defaultSubView("review")).toBe("journal");
  });

  it("validates modes", () => {
    expect(isValidMode("focus")).toBe(true);
    expect(isValidMode("explore")).toBe(true);
    expect(isValidMode("review")).toBe(true);
    expect(isValidMode("bogus")).toBe(false);
  });

  it("validates sub-views per mode", () => {
    expect(isValidSubView("explore", "positions")).toBe(true);
    expect(isValidSubView("explore", "monthly")).toBe(false);
    expect(isValidSubView("review", "journal")).toBe(true);
    expect(isValidSubView("review", "radar")).toBe(false);
    expect(isValidSubView("focus", null)).toBe(true);
    expect(isValidSubView("focus", "anything")).toBe(false);
  });
});

describe("baskets sub-view registration", () => {
  it("is a valid explore sub-view with a label", () => {
    expect(EXPLORE_SUBVIEWS).toContain("baskets");
    expect(SUBVIEW_LABELS.baskets).toBe("Baskets");
    expect(isValidSubView("explore", "baskets")).toBe(true);
  });
});

describe("ai-thesis sub-view registration", () => {
  it("is a valid explore sub-view with a label, placed after radar", () => {
    expect(EXPLORE_SUBVIEWS).toContain("ai-thesis");
    expect(SUBVIEW_LABELS["ai-thesis"]).toBe("AI Thesis");
    expect(isValidSubView("explore", "ai-thesis")).toBe(true);
    expect(EXPLORE_SUBVIEWS.indexOf("ai-thesis")).toBe(EXPLORE_SUBVIEWS.indexOf("radar") + 1);
  });
});
