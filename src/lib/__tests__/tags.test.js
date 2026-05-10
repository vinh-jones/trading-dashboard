import { describe, it, expect } from "vitest";
import { groupStrategicTagsByPosition, STRATEGIC_TAG_PREFIXES } from "../tags";

const positions = {
  open_csps: [
    { ticker: "SOFI", type: "CSP", strike: 14, expiry_date: "2026-06-19" },
    { ticker: "NVDA", type: "CSP", strike: 485, expiry_date: "2026-05-30" },
  ],
  open_leaps: [
    { ticker: "GOOGL", type: "LEAPS", strike: 230, expiry_date: "2027-01-15" },
  ],
  assigned_shares: [
    {
      ticker: "AAPL",
      active_cc: { ticker: "AAPL", type: "CC", strike: 220, expiry_date: "2026-05-23" },
    },
  ],
};

const entries = [
  // SOFI CSP — strategic earnings-play, should appear
  { id: "e1", ticker: "SOFI", type: "CSP", strike: 14, expiry: "2026-06-19", tags: ["earnings-play:path-c-standard", "signal:ryan"], created_at: "2026-05-08T10:00:00Z" },
  // SOFI CSP — second entry adds a macro tag, should union
  { id: "e2", ticker: "SOFI", type: "CSP", strike: 14, expiry: "2026-06-19", tags: ["macro:fed", "position-action:opened-csp"], created_at: "2026-05-09T10:00:00Z" },
  // NVDA CSP — only excluded categories, should produce empty result for NVDA
  { id: "e3", ticker: "NVDA", type: "CSP", strike: 485, expiry: "2026-05-30", tags: ["framework:60-60-applied", "drift:fatigue", "position-action:rolled-out"], created_at: "2026-05-09T10:00:00Z" },
  // AAPL — but tagged on Shares, not the CC. Match should hit Shares key.
  { id: "e4", ticker: "AAPL", type: "Shares", strike: null, expiry: null, tags: ["signal:independent"], created_at: "2026-05-09T10:00:00Z" },
  // AAPL CC — separate entry, should hit CC key
  { id: "e5", ticker: "AAPL", type: "CC", strike: 220, expiry: "2026-05-23", tags: ["earnings-play"], created_at: "2026-05-09T10:00:00Z" },
  // GOOGL LEAPS — should match LEAPS position
  { id: "e6", ticker: "GOOGL", type: "LEAPS", strike: 230, expiry: "2027-01-15", tags: ["macro:fed"], created_at: "2026-05-09T10:00:00Z" },
  // Unrelated ticker — should be ignored
  { id: "e7", ticker: "ZZZZ", type: "CSP", strike: 5, expiry: "2026-06-19", tags: ["signal:ryan"], created_at: "2026-05-09T10:00:00Z" },
];

describe("STRATEGIC_TAG_PREFIXES", () => {
  it("includes earnings-play, signal, macro and excludes others", () => {
    expect(STRATEGIC_TAG_PREFIXES).toEqual(["earnings-play", "signal", "macro"]);
  });
});

describe("groupStrategicTagsByPosition", () => {
  it("matches CSP positions by ticker+type+strike+expiry and unions strategic tags across entries", () => {
    const map = groupStrategicTagsByPosition(entries, positions);
    const sofi = map.get("SOFI|CSP|14|2026-06-19");
    expect(sofi).toBeTruthy();
    const tags = sofi.map(t => t.tag).sort();
    expect(tags).toEqual(["earnings-play:path-c-standard", "macro:fed", "signal:ryan"]);
  });

  it("excludes position-action, framework, and drift categories", () => {
    const map = groupStrategicTagsByPosition(entries, positions);
    const nvda = map.get("NVDA|CSP|485|2026-05-30");
    expect(nvda).toBeFalsy();
  });

  it("matches Shares positions by ticker+type only (no strike/expiry)", () => {
    const map = groupStrategicTagsByPosition(entries, positions);
    const shares = map.get("AAPL|Shares");
    expect(shares).toBeTruthy();
    expect(shares.map(t => t.tag)).toEqual(["signal:independent"]);
  });

  it("matches CC positions independently from their parent shares", () => {
    const map = groupStrategicTagsByPosition(entries, positions);
    const cc = map.get("AAPL|CC|220|2026-05-23");
    expect(cc).toBeTruthy();
    expect(cc.map(t => t.tag)).toEqual(["earnings-play"]);
  });

  it("matches LEAPS positions", () => {
    const map = groupStrategicTagsByPosition(entries, positions);
    const leaps = map.get("GOOGL|LEAPS|230|2027-01-15");
    expect(leaps).toBeTruthy();
    expect(leaps.map(t => t.tag)).toEqual(["macro:fed"]);
  });

  it("ignores entries for tickers with no open position", () => {
    const map = groupStrategicTagsByPosition(entries, positions);
    expect([...map.keys()].some(k => k.startsWith("ZZZZ"))).toBe(false);
  });

  it("dedupes the same tag appearing in multiple entries; clicking that tag should jump to the most recent", () => {
    const dupEntries = [
      { id: "old", ticker: "SOFI", type: "CSP", strike: 14, expiry: "2026-06-19", tags: ["signal:ryan"], created_at: "2026-05-01T10:00:00Z" },
      { id: "new", ticker: "SOFI", type: "CSP", strike: 14, expiry: "2026-06-19", tags: ["signal:ryan"], created_at: "2026-05-09T10:00:00Z" },
    ];
    const map = groupStrategicTagsByPosition(dupEntries, positions);
    const sofi = map.get("SOFI|CSP|14|2026-06-19");
    expect(sofi).toHaveLength(1);
    expect(sofi[0].tag).toBe("signal:ryan");
    expect(sofi[0].entryId).toBe("new"); // most recent
  });

  it("returns an empty map when no entries match", () => {
    const map = groupStrategicTagsByPosition([], positions);
    expect(map.size).toBe(0);
  });
});
