import { describe, it, expect } from "vitest";
import { isSyntheticShareAcquisition, planTradeJournalEntries } from "../sync.js";

// Share ACQUISITIONS (direct buys) are written to the trades table with
// close_date = open_date so they surface in the lifespan UI. They are not
// closes. The assigned_shares lots loop already journals them as
// "Shares — Opened", so the trades→journal loop must skip them — otherwise every
// bought/assigned lot also gets a misleading "Shares $X — Closed MM/DD" card.
// Genuine share SALES (subtype 'Sold') are real closes and keep their card.

describe("isSyntheticShareAcquisition", () => {
  it("flags a direct-buy / assigned share acquisition row", () => {
    expect(isSyntheticShareAcquisition({ type: "Shares", subtype: "Assigned" })).toBe(true);
  });

  it("does NOT flag a genuine share sale", () => {
    expect(isSyntheticShareAcquisition({ type: "Shares", subtype: "Sold" })).toBe(false);
  });

  it("does NOT flag option trades", () => {
    expect(isSyntheticShareAcquisition({ type: "CSP", subtype: "Assigned" })).toBe(false);
    expect(isSyntheticShareAcquisition({ type: "CC", subtype: "Close" })).toBe(false);
  });
});

// Two share lots of one ticker assigned away on the same day at the same strike
// have identical journal titles — "Shares — Closed 08/14" carries no basis, and
// share trades have no strike. The dedup key can't tell them apart, so it must
// not treat "a trade with this key was already journaled" as "this trade was
// already journaled" — that silently dropped the second lot from the feed.
describe("planTradeJournalEntries", () => {
  const NOW = "2026-08-14T19:00:00.000Z";
  const lot = (id, openDate) => ({
    id, ticker: "COHR", type: "Shares", subtype: "Sold",
    open_date: openDate, close_date: "2026-08-14", source: "Ryan",
  });

  it("journals both same-day share lots when neither is journaled yet", () => {
    const { toInsert } = planTradeJournalEntries({
      trades: [lot("t-350", "2026-07-17"), lot("t-246", "2026-07-30")],
      existing: [],
      now: NOW,
    });
    expect(toInsert.map(e => e.trade_id)).toEqual(["t-350", "t-246"]);
    expect(new Set(toInsert.map(e => e.title))).toEqual(new Set(["Shares — Closed 08/14"]));
  });

  it("journals the second lot when the first already has an entry", () => {
    const { toInsert } = planTradeJournalEntries({
      trades: [lot("t-350", "2026-07-17"), lot("t-246", "2026-07-30")],
      existing: [{
        id: "j-1", trade_id: "t-350", ticker: "COHR",
        entry_date: "2026-08-14", title: "Shares — Closed 08/14", body: "",
      }],
      now: NOW,
    });
    expect(toInsert.map(e => e.trade_id)).toEqual(["t-246"]);
  });

  it("lets one legacy (trade_id-less) entry cover exactly one colliding trade", () => {
    const { toInsert } = planTradeJournalEntries({
      trades: [lot("t-350", "2026-07-17"), lot("t-246", "2026-07-30")],
      existing: [{
        id: "j-legacy", trade_id: null, ticker: "COHR",
        entry_date: "2026-08-14", title: "Shares — Closed 08/14", body: "Assigned away!",
      }],
      now: NOW,
    });
    expect(toInsert.map(e => e.trade_id)).toEqual(["t-246"]);
  });

  it("matches a legacy entry whose title carries a kept-% suffix", () => {
    const csp = {
      id: "t-csp", ticker: "GLW", type: "CSP", strike: 130,
      open_date: "2026-07-01", close_date: "2026-08-14",
    };
    const { toInsert } = planTradeJournalEntries({
      trades: [csp],
      existing: [{
        id: "j-legacy", trade_id: null, ticker: "GLW",
        entry_date: "2026-08-14", title: "CSP $130 — Closed 08/14 (84%)", body: "",
      }],
      now: NOW,
    });
    expect(toInsert).toEqual([]);
  });

  it("corrects an un-annotated entry whose close date drifted", () => {
    const { toInsert, toUpdate } = planTradeJournalEntries({
      trades: [lot("t-350", "2026-07-17")],
      existing: [{
        id: "j-1", trade_id: "t-350", ticker: "COHR",
        entry_date: "2026-08-12", title: "Shares — Closed 08/12", body: "",
      }],
      now: NOW,
    });
    expect(toInsert).toEqual([]);
    expect(toUpdate).toEqual([
      { id: "j-1", entry_date: "2026-08-14", title: "Shares — Closed 08/14" },
    ]);
  });

  it("leaves an annotated entry's date and title alone", () => {
    const { toUpdate } = planTradeJournalEntries({
      trades: [lot("t-350", "2026-07-17")],
      existing: [{
        id: "j-1", trade_id: "t-350", ticker: "COHR",
        entry_date: "2026-08-12", title: "Shares — Closed 08/12", body: "Sold the high-basis lot.",
      }],
      now: NOW,
    });
    expect(toUpdate).toEqual([]);
  });

  it("skips synthetic share acquisitions", () => {
    const { toInsert } = planTradeJournalEntries({
      trades: [{ ...lot("t-assigned", "2026-07-17"), subtype: "Assigned", close_date: "2026-07-17" }],
      existing: [],
      now: NOW,
    });
    expect(toInsert).toEqual([]);
  });

  it("reports inserted keys so the open-position pass doesn't double-journal", () => {
    const { seenKeys } = planTradeJournalEntries({
      trades: [{ id: "t-open", ticker: "GLW", type: "CSP", strike: 130, open_date: "2026-08-14", close_date: null }],
      existing: [],
      now: NOW,
    });
    expect(seenKeys.has("GLW|2026-08-14|CSP $130 — Opened")).toBe(true);
  });
});
