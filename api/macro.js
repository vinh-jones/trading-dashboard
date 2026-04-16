/**
 * api/macro.js — Vercel serverless function
 *
 * GET /api/macro
 *
 * Fetches 5 macro signals in parallel (VIX, SPY, S5FI, Fear & Greed, FedWatch),
 * computes deterministic labels/scores, builds composite posture, and returns
 * a combined JSON response with an ai_context field for future LLM synthesis.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── Explanation maps ────────────────────────────────────────────────

const VIX_EXPLANATIONS = {
  "Very Low":
    "VIX below 12 indicates extreme complacency. Options are historically cheap — premium sellers get less compensation per contract. Deploy aggressively but watch for vol spikes.",
  Low: "VIX below 15 signals a calm, trending market. Ryan typically deploys aggressively at this level. Consider freeing up positions to capture remaining premium and redeploying at tighter strikes.",
  Moderate:
    "VIX in the 15-20 range is the sweet spot for the wheel strategy — enough premium to make positions worthwhile, not enough fear to signal elevated risk. Normal deployment posture.",
  Elevated:
    "VIX in the 20-25 range signals market uncertainty. Maintain 10-15% free cash per framework. Be selective with new entries. Watch for VIX spikes that create better entry opportunities.",
  High: "VIX in the 25-30 range indicates significant market stress. Maintain 15-20% free cash minimum. Focus on high-quality names only. Bear call spreads may be appropriate as a hedge.",
  "Very High":
    "VIX above 30 signals fear-driven selling. This is historically a zone where put premium is richest. Deploy carefully in tranches — do not go all-in. Keep 20%+ cash as buffer.",
  Extreme:
    "VIX above 40 indicates a market crisis. Prioritize capital preservation. Do not open new CSPs until VIX shows a clear downward trend. Watch for S5FI single-digit readings as a bottom signal.",
};

const S5FI_EXPLANATIONS = {
  "Strong Breadth":
    "Over 80% of S&P 500 stocks are above their 50-day MA — broad market participation in the uptrend. Historically constructive environment for premium selling. Risk: market may be extended.",
  "Healthy Breadth":
    "65-80% of stocks above 50-day MA. Solid broad-based strength. Good environment for the wheel strategy — uptrend has broad participation, not driven by a handful of names.",
  "Moderate Breadth":
    "50-65% of stocks above their 50-day MA. Mixed picture — half the market is in good shape, half is struggling. Be selective with new CSP entries.",
  Weakening:
    "35-50% of stocks above 50-day MA. More stocks are breaking down than recovering. Tighten up: reduce new deployments, prioritize higher-quality names, keep more cash.",
  Deteriorating:
    "20-35% of stocks above 50-day MA — a majority of the market is in a downtrend. This is correction territory. Avoid new CSPs on speculative names. Focus on capital preservation.",
  "Near Bottom Signal":
    "10-20% above 50-day MA. Ryan identified this zone as a near-bottom indicator during the tariffs crash — extreme oversold conditions historically precede relief rallies. Do not panic sell. Watch for VIX to start declining as confirmation.",
  "Extreme Oversold":
    "Under 10% of stocks above their 50-day MA — historically rare and extreme. During COVID this hit 0.97%. This level has historically marked significant market bottoms. Hold cash, watch for institutional buying signals.",
};

const FEAR_GREED_EXPLANATIONS = {
  "Extreme Greed":
    "Market sentiment is at extreme greed levels. Investors are highly risk-on — momentum is strong but the market may be getting frothy. Premium sellers benefit from elevated call premiums. Watch for reversal signals.",
  Greed: "Sentiment is in greed territory. Market participants are confident and risk-seeking. Generally favorable for the wheel strategy — stocks trending, put premiums reasonable, assignment risk lower.",
  Neutral:
    "Sentiment is balanced between fear and greed. No strong directional signal from sentiment alone. Let VIX and S5FI drive your posture read.",
  Fear: "Market participants are fearful. Put premiums are elevated — good for CSP sellers on quality names. But be selective: fear can become extreme fear quickly. Maintain adequate cash buffer.",
  "Extreme Fear":
    "Extreme fear in the market. Ryan noted this level (17) coincided with the tariff crash bottom. Historically a contrarian buy signal — institutions step in when retail is most fearful. Hold positions, do not panic close.",
};

const FEDWATCH_EXPLANATIONS = {
  "Strongly Dovish":
    "3+ rate cuts priced in over the next year. The market expects significant easing — cheap money flowing into risk assets. Historically very bullish for high-growth/high-beta stocks like PLTR and HOOD. Strong tailwind for the wheel strategy.",
  Dovish:
    "2 rate cuts priced in. The market expects meaningful easing. Risk assets benefit as lower rates push investors toward equities. Generally supportive environment for premium selling.",
  "Mildly Dovish":
    "1 rate cut expected in the next year. Modest tailwind — conditions are supportive but not strongly stimulative. Normal deployment posture is appropriate.",
  "Neutral/Hawkish":
    'Fewer than 1 cut expected — market is pricing "higher for longer." Not necessarily bearish, but the rate tailwind is absent. Be selective.',
  Hawkish:
    "Rate hikes are being priced in. This is a significant risk-off signal. Higher rates compress valuations and slow economic activity. Increase cash position, reduce speculative names.",
};

const SPY_EXPLANATIONS = {
  "At Resistance":
    "SPY is at or near all-time highs — a technical resistance level. Markets often consolidate or pull back here. Ryan mentioned this as a reason to hold off on bear call spreads. Not bearish, but watch for rejection.",
  "Just Below ATH":
    "SPY within 3% of all-time highs. Recovery is nearly complete. Constructive for premium selling — stocks are performing well but haven't pushed into uncharted territory yet.",
  Recovering:
    "SPY 3-8% below ATH. Recovery mode — stocks have bounced from lows and are rebuilding. Good environment for CSPs on quality names as the trend reasserts.",
  Correction:
    "SPY 8-15% below ATH. Standard correction territory. Quality names are on sale. Elevated put premiums create good CSP opportunities — but be selective and maintain cash buffer.",
  "Bear Territory":
    "SPY 15-25% below ATH. Significant drawdown. Watch S5FI and Fear & Greed for bottom signals before deploying aggressively. Focus on capital preservation.",
  "Deep Bear":
    "SPY more than 25% below ATH. Bear market conditions. Minimum deployment until clear reversal signals appear across multiple indicators.",
};

// ─── Labeling functions ──────────────────────────────────────────────

function labelVix(value) {
  let score, label;
  if (value < 12) {
    score = 5;
    label = "Very Low";
  } else if (value < 15) {
    score = 5;
    label = "Low";
  } else if (value < 20) {
    score = 4;
    label = "Moderate";
  } else if (value < 25) {
    score = 3;
    label = "Elevated";
  } else if (value < 30) {
    score = 2;
    label = "High";
  } else if (value < 40) {
    score = 1;
    label = "Very High";
  } else {
    score = 1;
    label = "Extreme";
  }
  const color = score >= 4 ? "green" : score >= 3 ? "amber" : "red";
  return { score, label, color, explanation: VIX_EXPLANATIONS[label] };
}

function labelS5fi(value) {
  let score, label;
  if (value > 80) {
    score = 5;
    label = "Strong Breadth";
  } else if (value > 65) {
    score = 4;
    label = "Healthy Breadth";
  } else if (value > 50) {
    score = 4;
    label = "Moderate Breadth";
  } else if (value > 35) {
    score = 3;
    label = "Weakening";
  } else if (value > 20) {
    score = 2;
    label = "Deteriorating";
  } else if (value > 10) {
    score = 1;
    label = "Near Bottom Signal";
  } else {
    score = 1;
    label = "Extreme Oversold";
  }
  const color = score >= 4 ? "green" : score >= 3 ? "amber" : "red";
  return { score, label, color, explanation: S5FI_EXPLANATIONS[label] };
}

function labelFearGreed(value) {
  let score, label;
  if (value >= 75) {
    score = 5;
    label = "Extreme Greed";
  } else if (value >= 55) {
    score = 4;
    label = "Greed";
  } else if (value >= 45) {
    score = 3;
    label = "Neutral";
  } else if (value >= 25) {
    score = 2;
    label = "Fear";
  } else {
    score = 1;
    label = "Extreme Fear";
  }
  const color = score >= 4 ? "green" : score >= 3 ? "amber" : "red";
  return { score, label, color, explanation: FEAR_GREED_EXPLANATIONS[label] };
}

function labelFedWatch(cutsPricedIn, weeklyChangeBps) {
  let score, label;
  if (cutsPricedIn >= 3) {
    score = 5;
    label = "Strongly Dovish";
  } else if (cutsPricedIn >= 2) {
    score = 4;
    label = "Dovish";
  } else if (cutsPricedIn >= 1) {
    score = 3;
    label = "Mildly Dovish";
  } else if (cutsPricedIn >= 0) {
    score = 2;
    label = "Neutral/Hawkish";
  } else {
    score = 1;
    label = "Hawkish";
  }
  const color = score >= 4 ? "green" : score >= 3 ? "amber" : "red";

  let direction;
  if (weeklyChangeBps < -5) direction = "more dovish this week";
  else if (weeklyChangeBps > 5) direction = "more hawkish this week";
  else direction = "unchanged this week";

  return {
    score,
    label,
    color,
    direction,
    explanation: FEDWATCH_EXPLANATIONS[label],
  };
}

function labelSpyVsAth(pctFromHigh) {
  let score, label;
  if (pctFromHigh >= -0.01) {
    score = 3;
    label = "At Resistance";
  } else if (pctFromHigh >= -0.03) {
    score = 4;
    label = "Just Below ATH";
  } else if (pctFromHigh >= -0.08) {
    score = 4;
    label = "Recovering";
  } else if (pctFromHigh >= -0.15) {
    score = 3;
    label = "Correction";
  } else if (pctFromHigh >= -0.25) {
    score = 2;
    label = "Bear Territory";
  } else {
    score = 1;
    label = "Deep Bear";
  }
  const color = score >= 4 ? "green" : score >= 3 ? "amber" : "red";
  return { score, label, color, explanation: SPY_EXPLANATIONS[label] };
}

// ─── Signal fetchers ─────────────────────────────────────────────────

async function fetchVixAndSpy() {
  const headers = { "User-Agent": UA, Accept: "application/json" };

  const [vixRes, spyRes] = await Promise.all([
    fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=1d",
      { headers }
    ),
    fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1d",
      { headers }
    ),
  ]);

  if (!vixRes.ok) throw new Error(`Yahoo VIX returned ${vixRes.status}`);
  if (!spyRes.ok) throw new Error(`Yahoo SPY returned ${spyRes.status}`);

  const vixData = await vixRes.json();
  const spyData = await spyRes.json();

  const vixMeta = vixData?.chart?.result?.[0]?.meta;
  const spyMeta = spyData?.chart?.result?.[0]?.meta;

  if (!vixMeta || !spyMeta) throw new Error("Missing chart meta from Yahoo");

  const vixPrice = vixMeta.regularMarketPrice;
  const vixPrevClose = vixMeta.chartPreviousClose;

  const spyPrice = spyMeta.regularMarketPrice;
  const spyHigh = spyMeta.fiftyTwoWeekHigh;

  return { vixPrice, vixPrevClose, spyPrice, spyHigh };
}

async function fetchFearGreed() {
  const today = new Date().toISOString().split("T")[0];
  const url = `https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${today}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Referer: "https://www.cnn.com/markets/fear-and-greed",
    },
  });

  if (!res.ok) throw new Error(`CNN Fear & Greed returned ${res.status}`);

  const data = await res.json();
  const fg = data?.fear_and_greed;
  if (!fg) throw new Error("Missing fear_and_greed in CNN response");

  return {
    score: fg.score,
    rating: fg.rating,
    previousClose: fg.previous_close,
    prev1w: fg.previous_1_week,
    prev1m: fg.previous_1_month,
    prev1y: fg.previous_1_year,
  };
}

async function fetchS5fi() {
  const headers = { "User-Agent": UA };

  const [totalRes, aboveRes] = await Promise.all([
    fetch("https://finviz.com/screener.ashx?v=111&f=idx_sp500&ft=4", {
      headers,
    }),
    fetch(
      "https://finviz.com/screener.ashx?v=111&f=idx_sp500,ta_sma50_pa&ft=4",
      { headers }
    ),
  ]);

  if (!totalRes.ok) throw new Error(`Finviz total returned ${totalRes.status}`);
  if (!aboveRes.ok)
    throw new Error(`Finviz above returned ${aboveRes.status}`);

  const totalHtml = await totalRes.text();
  const aboveHtml = await aboveRes.text();

  const totalMatch = totalHtml.match(/#1\s*\/\s*(\d+)/);
  if (!totalMatch) throw new Error("Could not parse total count from Finviz");
  const total = parseInt(totalMatch[1], 10);

  let above = 0;
  if (!aboveHtml.includes("No results")) {
    const aboveMatch = aboveHtml.match(/#1\s*\/\s*(\d+)/);
    if (aboveMatch) above = parseInt(aboveMatch[1], 10);
  }

  const pct = Math.round((above / total) * 1000) / 10;
  return { pct, above, total };
}

async function fetchFedWatch() {
  const res = await fetch("https://rateprobability.com/api/latest", {
    headers: { "User-Agent": UA },
  });

  if (!res.ok) throw new Error(`rateprobability returned ${res.status}`);

  const data = await res.json();
  const todayRows = data?.data?.today?.rows;
  const weekAgoRows = data?.data?.ago_1w?.rows;

  if (!todayRows || !todayRows.length)
    throw new Error("Missing FedWatch rows");

  const currentRate = data.data.today.midpoint;
  const nextMeetingDate = todayRows[0].meeting_iso;

  // Find current year December meeting
  const currentYear = new Date().getFullYear();
  const decPrefix = `${currentYear}-12`;
  const decRow = todayRows.find((r) => r.meeting_iso.startsWith(decPrefix));

  // Determine end-of-year implied rate
  const endOfYearImplied = decRow
    ? decRow.implied_rate_post_meeting
    : null;

  // Cuts priced in: last meeting within 12 months
  const now = new Date();
  const oneYearOut = new Date(now);
  oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);

  const withinYear = todayRows.filter(
    (r) => new Date(r.meeting_iso) <= oneYearOut
  );
  const lastMeeting = withinYear[withinYear.length - 1];

  let cutsPricedIn = 0;
  if (lastMeeting) {
    cutsPricedIn = lastMeeting.num_moves_is_cut
      ? lastMeeting.num_moves
      : -lastMeeting.num_moves;
  }

  // Weekly change in bps for Dec meeting implied rate
  let weeklyChangeBps = null;
  if (decRow && weekAgoRows) {
    const weekAgoDecRow = weekAgoRows.find((r) =>
      r.meeting_iso.startsWith(decPrefix)
    );
    if (weekAgoDecRow) {
      weeklyChangeBps = Math.round(
        (decRow.implied_rate_post_meeting -
          weekAgoDecRow.implied_rate_post_meeting) *
          100
      );
    }
  }

  // Curve direction
  const firstImplied = todayRows[0].implied_rate_post_meeting;
  const lastImplied = todayRows[todayRows.length - 1].implied_rate_post_meeting;
  let curveDirection;
  if (lastImplied < firstImplied) curveDirection = "declining";
  else if (lastImplied > firstImplied) curveDirection = "rising";
  else curveDirection = "flat";

  return {
    cutsPricedIn,
    endOfYearImplied,
    currentRate,
    nextMeetingDate,
    weeklyChangeBps,
    curveDirection,
  };
}

// ─── Composite posture ──────────────────────────────────────────────

const POSTURE_MAP = [
  {
    min: 4.2,
    posture: "BULLISH",
    description:
      "Multiple indicators signal strong risk-on conditions. Broad market participation, low fear, and supportive monetary policy create a favorable environment for premium selling.",
    deploymentGuidance:
      "Deploy aggressively. Target 85-95% capital utilization. Use tighter strikes for higher premium capture. Consider adding positions in high-beta names.",
  },
  {
    min: 3.4,
    posture: "CONSTRUCTIVE",
    description:
      "Most indicators are positive with minor caution flags. The overall environment supports the wheel strategy with normal position sizing.",
    deploymentGuidance:
      "Normal deployment posture. Target 70-85% capital utilization. Standard strike selection. Maintain watchlist for opportunistic entries on dips.",
  },
  {
    min: 2.6,
    posture: "NEUTRAL",
    description:
      "Mixed signals across indicators. Some positive, some cautionary. No strong directional bias from macro conditions.",
    deploymentGuidance:
      "Moderate deployment. Target 60-75% capital utilization. Be selective with new entries. Maintain 15-20% cash buffer. Favor quality over quantity.",
  },
  {
    min: 1.8,
    posture: "DEFENSIVE",
    description:
      "Multiple indicators signal elevated risk. Market conditions warrant caution and reduced exposure.",
    deploymentGuidance:
      "Reduce exposure. Target 40-60% capital utilization. Focus only on highest-conviction names. Maintain 25%+ cash. Consider protective positions.",
  },
  {
    min: -Infinity,
    posture: "BEARISH",
    description:
      "Broad risk-off signals across most indicators. Market conditions are hostile to premium selling strategies.",
    deploymentGuidance:
      "Minimum deployment. Target under 40% capital utilization. Close speculative positions. Prioritize capital preservation. Wait for clear reversal signals across multiple indicators before re-deploying.",
  },
];

function computePosture(scores) {
  const avg = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
  const entry = POSTURE_MAP.find((p) => avg >= p.min);
  return {
    posture: entry.posture,
    avg,
    scores,
    description: entry.description,
    deploymentGuidance: entry.deploymentGuidance,
  };
}

// ─── ai_context builder ─────────────────────────────────────────────

function buildAiContext(posture, signals, asOf) {
  const date = new Date(asOf).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const lines = [
    `MACRO MARKET CONTEXT — ${date}`,
    "",
    `OVERALL POSTURE: ${posture.posture} (avg score ${posture.avg}/5)`,
    posture.description,
    `Deployment guidance: ${posture.deploymentGuidance}`,
    "",
    "─── INDIVIDUAL SIGNALS ───",
    "",
  ];

  const { vix, s5fi, fearGreed, fedWatch, spyVsAth } = signals;

  lines.push(`VIX: ${vix.value} (${vix.label}, score ${vix.score}/5)`);
  if (vix.change != null) lines.push(`  Change: ${vix.change > 0 ? "+" : ""}${vix.change}`);
  lines.push(`  ${vix.explanation}`);
  lines.push("");

  lines.push(`S5FI (% above 50-day MA): ${s5fi.value}% (${s5fi.label}, score ${s5fi.score}/5)`);
  lines.push(`  ${s5fi.explanation}`);
  lines.push("");

  lines.push(
    `Fear & Greed Index: ${fearGreed.value} (${fearGreed.label}, score ${fearGreed.score}/5)`
  );
  if (fearGreed.prev1w != null)
    lines.push(
      `  1w ago: ${fearGreed.prev1w} | 1m ago: ${fearGreed.prev1m} | 1y ago: ${fearGreed.prev1y}`
    );
  lines.push(`  ${fearGreed.explanation}`);
  lines.push("");

  lines.push(
    `Fed Rate Expectations: ${fedWatch.label} (score ${fedWatch.score}/5)`
  );
  lines.push(`  Cuts priced in (12m): ${fedWatch.cutsPricedIn}`);
  if (fedWatch.endOfYearImplied != null)
    lines.push(`  End-of-year implied rate: ${fedWatch.endOfYearImplied}%`);
  lines.push(`  Current rate: ${fedWatch.currentRate}%`);
  if (fedWatch.direction) lines.push(`  Direction: ${fedWatch.direction}`);
  lines.push(`  ${fedWatch.explanation}`);
  lines.push("");

  lines.push(
    `SPY vs ATH: ${spyVsAth.value} (${spyVsAth.label}, score ${spyVsAth.score}/5)`
  );
  if (spyVsAth.pctFromHigh != null)
    lines.push(
      `  52-week high: ${spyVsAth.high} | ${(spyVsAth.pctFromHigh * 100).toFixed(2)}% from high`
    );
  lines.push(`  ${spyVsAth.explanation}`);

  return lines.join("\n");
}

// ─── Main handler ───────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const asOf = new Date().toISOString();

  // Fetch all signals in parallel — one failure doesn't break others
  const [vixSpyResult, fgResult, s5fiResult, fedResult] =
    await Promise.allSettled([
      fetchVixAndSpy(),
      fetchFearGreed(),
      fetchS5fi(),
      fetchFedWatch(),
    ]);

  // ─── VIX ───
  let vixSignal;
  if (vixSpyResult.status === "fulfilled") {
    const { vixPrice, vixPrevClose } = vixSpyResult.value;
    const change =
      Math.round((vixPrice - vixPrevClose) * 100) / 100;
    const labeled = labelVix(vixPrice);
    vixSignal = { value: vixPrice, change, ...labeled };
  } else {
    vixSignal = {
      value: null,
      change: null,
      score: 3,
      label: "Unavailable",
      color: "amber",
      explanation: `VIX data unavailable: ${vixSpyResult.reason?.message || "fetch failed"}`,
    };
  }

  // ─── SPY vs ATH ───
  let spySignal;
  if (vixSpyResult.status === "fulfilled") {
    const { spyPrice, spyHigh } = vixSpyResult.value;
    const pctFromHigh = (spyPrice - spyHigh) / spyHigh;
    const labeled = labelSpyVsAth(pctFromHigh);
    spySignal = {
      value: spyPrice,
      high: spyHigh,
      pctFromHigh: Math.round(pctFromHigh * 1000000) / 1000000,
      ...labeled,
    };
  } else {
    spySignal = {
      value: null,
      high: null,
      pctFromHigh: null,
      score: 3,
      label: "Unavailable",
      color: "amber",
      explanation: `SPY data unavailable: ${vixSpyResult.reason?.message || "fetch failed"}`,
    };
  }

  // ─── S5FI ───
  let s5fiSignal;
  if (s5fiResult.status === "fulfilled") {
    const { pct } = s5fiResult.value;
    const labeled = labelS5fi(pct);
    s5fiSignal = { value: pct, ...labeled };
  } else {
    s5fiSignal = {
      value: null,
      score: 3,
      label: "Unavailable",
      color: "amber",
      explanation: `S5FI data unavailable: ${s5fiResult.reason?.message || "fetch failed"}`,
    };
  }

  // ─── Fear & Greed ───
  let fgSignal;
  if (fgResult.status === "fulfilled") {
    const fg = fgResult.value;
    const labeled = labelFearGreed(fg.score);
    fgSignal = {
      value: fg.score,
      prev1w: fg.prev1w,
      prev1m: fg.prev1m,
      prev1y: fg.prev1y,
      previousClose: fg.previousClose,
      ...labeled,
    };
  } else {
    fgSignal = {
      value: null,
      prev1w: null,
      prev1m: null,
      prev1y: null,
      previousClose: null,
      score: 3,
      label: "Unavailable",
      color: "amber",
      explanation: `Fear & Greed data unavailable: ${fgResult.reason?.message || "fetch failed"}`,
    };
  }

  // ─── FedWatch ───
  let fedSignal;
  if (fedResult.status === "fulfilled") {
    const fed = fedResult.value;
    const labeled = labelFedWatch(fed.cutsPricedIn, fed.weeklyChangeBps);
    fedSignal = {
      cutsPricedIn: fed.cutsPricedIn,
      endOfYearImplied: fed.endOfYearImplied,
      currentRate: fed.currentRate,
      nextMeetingDate: fed.nextMeetingDate,
      weeklyChangeBps: fed.weeklyChangeBps,
      curveDirection: fed.curveDirection,
      ...labeled,
    };
  } else {
    fedSignal = {
      cutsPricedIn: null,
      endOfYearImplied: null,
      currentRate: null,
      nextMeetingDate: null,
      weeklyChangeBps: null,
      curveDirection: null,
      score: 2,
      label: "Unavailable",
      color: "amber",
      direction: null,
      explanation: `FedWatch data unavailable: ${fedResult.reason?.message || "fetch failed"}`,
    };
  }

  // ─── Composite posture ───
  const scores = [
    vixSignal.score,
    s5fiSignal.score,
    fgSignal.score,
    fedSignal.score,
    spySignal.score,
  ];
  const posture = computePosture(scores);

  const signals = {
    vix: vixSignal,
    s5fi: s5fiSignal,
    fearGreed: fgSignal,
    fedWatch: fedSignal,
    spyVsAth: spySignal,
  };

  const aiContext = buildAiContext(posture, signals, asOf);

  res.setHeader(
    "Cache-Control",
    "s-maxage=1800, stale-while-revalidate=300"
  );
  res.status(200).json({
    ok: true,
    as_of: asOf,
    posture,
    signals,
    ai_context: aiContext,
  });
}
