/**
 * api/macro.js — Vercel serverless function
 *
 * GET /api/macro
 *
 * Fetches 7 macro signals in parallel (VIX, SPY, S5FI, Fear & Greed, FedWatch, Crude Oil, 10-Year Yield),
 * computes deterministic labels/scores, builds composite posture, and returns
 * a combined JSON response with an ai_context field for future LLM synthesis.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── Explanation maps ────────────────────────────────────────────────

const VIX_EXPLANATIONS = {
  "Extreme Greed":
    `VIX below 12 — the market is at peak complacency. Options premiums are historically thin, meaning you're getting paid very little for the risk you're taking. Ryan's framework calls for 40–50% cash at this level. This is counterintuitive: low fear = hold more cash, not less. Wait patiently for the next volatility spike.`,
  Greed:
    `VIX 12–15 — market participants are confident and greedy. Premiums are weak relative to historical averages. Ryan targets 30–40% cash here. Premium selling still works but you're not getting paid as well. Be selective — focus on higher-IV names from your approved list.`,
  "Slight Fear":
    `VIX 15–20 — the Goldilocks zone for the wheel strategy. Enough fear to generate meaningful premiums, not so much fear that assignment risk spikes. Ryan targets 20–25% cash and deploys aggressively here. This is the environment where the wheel strategy performs best. Follow Ryan signals, stay within allocation limits.`,
  Fear:
    `VIX 20–25 — elevated fear creates elevated premiums. Ryan targets 10–15% cash — deploy aggressively. Put premiums are rich, creating better risk/reward for CSPs. High-quality names that have sold off present the best entries. This is when Ryan has historically generated the most premium income.`,
  "Very Fearful":
    `VIX 25–30 — significant market fear. Ryan targets 5–10% cash — nearly all-in. Premiums are very elevated. Be selective about quality (stick to Tier 1 names), but do not hesitate to deploy. The temptation to hold cash "until things calm down" is the exact mistake to avoid at this VIX level.`,
  "Extreme Fear":
    `VIX above 30 — market crisis conditions. Ryan targets 0–5% cash and has historically injected new capital from outside the account at this level. This is maximum opportunity for premium sellers willing to take on short-term volatility. Watch S5FI for confirmation (single digits = major bottom). Not the time to panic — it's the time to deploy.`,
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

const OIL_EXPLANATIONS = {
  "Very Bullish":
    `WTI crude below $70 is a significant tailwind for the market. Low oil prices reduce inflation pressure across the economy, keeping rate cut expectations alive. Ryan has noted that oil dropping into the $70s "marks a bottom for the overall market." Strong conditions for the wheel strategy.`,
  Bullish:
    `WTI crude in the $70-80 range is the sweet spot. Inflation pressure from energy is manageable, rate cuts remain on the table, and the economy isn't being strangled by high energy costs. Ryan considers this range healthy for risk assets. Normal to aggressive deployment posture.`,
  Manageable:
    `WTI crude in the $80-90 range is a yellow flag. Oil is elevated but hasn't yet triggered significant inflation concerns. Watch the FedWatch signal — if oil stays in this range, rate cut probabilities may start drifting lower. Be selective with new positions.`,
  Concerning:
    `WTI crude above $90 is a meaningful risk. At this level, energy costs start feeding into broader inflation, making it harder for the Fed to justify rate cuts. Ryan has described this zone as "not good." Watch for FedWatch probabilities shifting hawkish — if both signals are negative, reduce deployment.`,
  Bearish:
    `WTI crude above $100 is a serious threat. Ryan: "Going to lead to global inflation." At this level, rate cuts get pushed out or cancelled, consumer spending weakens, and high-growth stocks (PLTR, HOOD, etc.) face multiple compression. Shift to defensive posture — increase cash, focus on lower-beta names.`,
  Crisis:
    `WTI crude above $120 has historically preceded recessions. At this level the inflation/rate dynamic becomes very unfavorable for equities. Ryan considers this worst-case. Capital preservation mode — maximum cash, minimal new deployment, monitor for policy response.`,
};

const YIELD_EXPLANATIONS = {
  "Very Bullish":
    `10-year yields below 3.5% — money is flowing into equities because bonds offer minimal real return. At this level, the opportunity cost of owning stocks vs. bonds is very low, supporting elevated valuations. Historically strong tailwind for high-growth names in the wheel universe (PLTR, HOOD, etc.).`,
  Bullish:
    `10-year yields in the 3.5-4% range are equity-friendly. Ryan's threshold: yields "in the 3s" means money rotates from bonds to equities because Treasury returns barely beat inflation. Risk assets benefit from this rotation. Good environment for the wheel strategy.`,
  Neutral:
    `10-year yields in the 4-4.5% range are the current equilibrium zone. Bonds offer a meaningful risk-free return but equities can still compete. Neither a strong headwind nor tailwind. Watch the direction of change — rising yields in this range are a warning sign.`,
  Restrictive:
    `10-year yields above 4.5% are a headwind for equities. Ryan: "Not good for interest rates long term." At this level, bonds become a competitive alternative to stocks, compressing equity valuations. High-multiple growth stocks (PLTR at 200x PE) are most exposed. Reduce speculative names.`,
  "Very Restrictive":
    `10-year yields above 5% are significantly restrictive. The last time yields stayed above 5% for an extended period was 2007. At this level, credit costs rise, corporate margins compress, and equity valuations face structural pressure. Shift to high-quality, low-multiple names only.`,
};

// ─── Labeling functions ──────────────────────────────────────────────

function labelVix(value) {
  let score, label, cashTarget, investedTarget;
  if (value <= 12) {
    score = 2; label = "Extreme Greed"; cashTarget = "40–50%"; investedTarget = "50–60%";
  } else if (value <= 15) {
    score = 3; label = "Greed"; cashTarget = "30–40%"; investedTarget = "60–70%";
  } else if (value <= 20) {
    score = 5; label = "Slight Fear"; cashTarget = "20–25%"; investedTarget = "75–80%";
  } else if (value <= 25) {
    score = 5; label = "Fear"; cashTarget = "10–15%"; investedTarget = "85–90%";
  } else if (value <= 30) {
    score = 4; label = "Very Fearful"; cashTarget = "5–10%"; investedTarget = "90–95%";
  } else {
    score = 3; label = "Extreme Fear"; cashTarget = "0–5% + new cash"; investedTarget = "95–100%";
  }
  const color = score >= 4 ? "green" : score >= 3 ? "amber" : "red";
  return { score, label, cashTarget, investedTarget, color, explanation: VIX_EXPLANATIONS[label] };
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

  // Directional modifier — weekly change in end-of-horizon implied rate
  // Negative bps = rates declining = more cuts = dovish = bullish modifier
  // Positive bps = rates rising = fewer cuts = hawkish = bearish modifier
  let directionLabel, directionArrow;
  if (weeklyChangeBps === null) {
    directionLabel = "direction unknown";
    directionArrow = "—";
  } else if (weeklyChangeBps < -5) {
    score += 0.5;
    directionLabel = "becoming more dovish";
    directionArrow = "↑";
  } else if (weeklyChangeBps > 5) {
    score -= 0.5;
    directionLabel = "becoming more hawkish";
    directionArrow = "↓";
  } else {
    directionLabel = "unchanged this week";
    directionArrow = "↔";
  }

  score = Math.max(1, Math.min(5, score));
  const color = score >= 4 ? "green" : score >= 3 ? "amber" : "red";

  return {
    score,
    label,
    color,
    directionLabel,
    directionArrow,
    weeklyChangeBps,
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

function labelCrudeOil(price) {
  let score, label;
  if (price < 70) {
    score = 5;
    label = "Very Bullish";
  } else if (price < 80) {
    score = 5;
    label = "Bullish";
  } else if (price < 90) {
    score = 3;
    label = "Manageable";
  } else if (price < 100) {
    score = 2;
    label = "Concerning";
  } else if (price < 120) {
    score = 1;
    label = "Bearish";
  } else {
    score = 1;
    label = "Crisis";
  }
  const color = score >= 4 ? "green" : score >= 3 ? "amber" : "red";
  return { score, label, color, explanation: OIL_EXPLANATIONS[label] };
}

function labelTenYearYield(yld) {
  let score, label;
  if (yld < 3.5) {
    score = 5;
    label = "Very Bullish";
  } else if (yld < 4.0) {
    score = 4;
    label = "Bullish";
  } else if (yld < 4.5) {
    score = 3;
    label = "Neutral";
  } else if (yld < 5.0) {
    score = 2;
    label = "Restrictive";
  } else {
    score = 1;
    label = "Very Restrictive";
  }
  const color = score >= 4 ? "green" : score >= 3 ? "amber" : "red";
  return { score, label, color, explanation: YIELD_EXPLANATIONS[label] };
}

// ─── Signal fetchers ─────────────────────────────────────────────────

async function fetchYahooChart(symbol, range = "1d") {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=${range}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} returned ${res.status}`);
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`Missing chart meta for ${symbol}`);
  return meta;
}

async function fetchVix() {
  const encoded = encodeURIComponent("^VIX");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=5d`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo ^VIX returned ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("Missing chart result for ^VIX");
  const meta = result.meta;
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  return {
    vixPrice: meta.regularMarketPrice,
    vixPrevClose: meta.chartPreviousClose,
    closes,
  };
}

function computeVixTrend(closes) {
  if (!closes || closes.length < 2) return null;
  const validCloses = closes.filter((c) => c != null);
  if (validCloses.length < 2) return null;
  const recent = validCloses[validCloses.length - 1];
  const fiveDago = validCloses[0];
  const change = Math.round((recent - fiveDago) * 100) / 100;

  let direction, label, color;
  if (change < -2)              { direction = "falling"; label = "Falling"; color = "green"; }
  else if (change < -0.5)      { direction = "easing";  label = "Easing";  color = "green"; }
  else if (Math.abs(change) <= 0.5) { direction = "stable"; label = "Stable"; color = "amber"; }
  else if (change < 2)         { direction = "rising";  label = "Rising";  color = "amber"; }
  else                         { direction = "spiking"; label = "Spiking"; color = "red"; }

  return { direction, label, color, changePts: change };
}

async function fetchSpy() {
  const meta = await fetchYahooChart("SPY");
  return {
    spyPrice: meta.regularMarketPrice,
    spyHigh: meta.fiftyTwoWeekHigh,
  };
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
  const todayRows = data?.today?.rows;
  const weekAgoRows = data?.ago_1w?.rows;

  if (!todayRows || !todayRows.length)
    throw new Error("Missing FedWatch rows");

  const currentRate = data.today.midpoint;
  const nextMeetingDate = todayRows[0].meeting_iso;
  const probMovePct = todayRows[0].prob_move_pct ?? null;
  const probIsCut = todayRows[0].prob_is_cut ?? false;

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

  // 55% threshold check — Ryan's historical rule: 55%+ cut probability within 7 days = cut is coming
  const today = new Date();
  const nextMeetingDateObj = new Date(nextMeetingDate);
  const daysToNextMeeting = Math.ceil((nextMeetingDateObj - today) / (1000 * 60 * 60 * 24));
  const probCut = probIsCut ? (probMovePct ?? 0) : 0;
  const isWithinWeek = daysToNextMeeting <= 7;
  const threshold55Met = isWithinWeek && probCut >= 55;

  return {
    cutsPricedIn,
    endOfYearImplied,
    currentRate,
    nextMeetingDate,
    weeklyChangeBps,
    curveDirection,
    probCut,
    daysToNextMeeting,
    isWithinWeek,
    threshold55Met,
  };
}

async function fetchCrudeOil() {
  const meta = await fetchYahooChart("CL=F", "5d");
  const price = meta.regularMarketPrice;
  const previousClose = meta.chartPreviousClose;
  return {
    price,
    previousClose,
    change: Math.round((price - previousClose) * 100) / 100,
    changePct: (price - previousClose) / previousClose,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
  };
}

async function fetchTenYearYield() {
  // ^TNX returns yield directly as a number (e.g. 4.32 = 4.32%)
  const meta = await fetchYahooChart("^TNX", "5d");
  const yld = meta.regularMarketPrice;
  const previousClose = meta.chartPreviousClose;
  return {
    yield: yld,
    previousClose,
    change: Math.round((yld - previousClose) * 10000) / 10000,
    changePct: (yld - previousClose) / previousClose,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
  };
}

// ─── Composite posture ──────────────────────────────────────────────

const POSTURE_MAP = [
  {
    min: 4.2,
    posture: "BULLISH",
    description:
      "All signals aligned positively. Strong conditions for premium selling.",
    deploymentGuidance:
      "Deploy aggressively. Chase stocks higher with tighter strikes. VIX permitting, push toward lower cash floor.",
  },
  {
    min: 3.4,
    posture: "CONSTRUCTIVE",
    description:
      "Most signals positive with minor headwinds. Good environment for the wheel strategy.",
    deploymentGuidance:
      "Normal deployment. Follow Ryan signals. Stay within VIX cash bands. Let winning positions run.",
  },
  {
    min: 2.6,
    posture: "NEUTRAL",
    description:
      "Mixed signals — some positive, some negative. Proceed with caution.",
    deploymentGuidance:
      "Selective deployment only. Higher-quality names, wider strikes. Hold 20-25% cash. Wait for clearer signals.",
  },
  {
    min: 1.8,
    posture: "DEFENSIVE",
    description:
      "Majority of signals negative. Elevated risk environment.",
    deploymentGuidance:
      "Minimal new deployment. Focus on managing existing positions. 25-35% cash. Consider bear call spreads as hedge.",
  },
  {
    min: -Infinity,
    posture: "BEARISH",
    description:
      "Signals aligned negatively. Capital preservation mode.",
    deploymentGuidance:
      "No new CSPs. Manage assignments defensively. Maximum cash position. Watch for S5FI single-digit readings as a bottom signal.",
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

  const { vix, s5fi, fearGreed, fedWatch, spyVsAth, crudeOil, tenYearYield } = signals;

  lines.push(`VIX: ${vix.value} (${vix.label}, score ${vix.score}/5)`);
  if (vix.change != null) lines.push(`  Change: ${vix.change > 0 ? "+" : ""}${vix.change} today`);
  if (vix.vixTrend) {
    const t = vix.vixTrend;
    const sign = t.changePts >= 0 ? "+" : "";
    lines.push(`  Trend: ${t.label} (${sign}${t.changePts.toFixed(1)} pts over 5 days) — fear is ${t.direction === "falling" || t.direction === "easing" ? "subsiding, market recovering" : t.direction === "stable" ? "stable" : "rising, caution warranted"}`);
  }
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
  lines.push("");

  if (crudeOil.price != null) {
    const oilDir = crudeOil.change > 0
      ? `Rising +$${crudeOil.change.toFixed(2)} (bearish)`
      : `Falling $${crudeOil.change.toFixed(2)} (bullish)`;
    lines.push(`Crude Oil (WTI): $${crudeOil.price.toFixed(2)}/bbl — ${crudeOil.label} (score: ${crudeOil.score}/5)`);
    lines.push(`  ${crudeOil.explanation}`);
    lines.push(`  Direction: ${oilDir}`);
    lines.push(`  Note: Oil is the primary variable influencing rate cut timing. Watch with Rate Expectations.`);
  } else {
    lines.push(`Crude Oil (WTI): Unavailable`);
  }
  lines.push("");

  if (tenYearYield.yield != null) {
    const bps = Math.round(tenYearYield.change * 100);
    const yldDir = tenYearYield.change > 0
      ? `Rising +${bps} bps (bearish)`
      : `Falling ${bps} bps (bullish)`;
    lines.push(`10-Year Treasury Yield: ${tenYearYield.yield.toFixed(2)}% — ${tenYearYield.label} (score: ${tenYearYield.score}/5)`);
    lines.push(`  ${tenYearYield.explanation}`);
    lines.push(`  Direction: ${yldDir}`);
    lines.push(`  52-week range: ${tenYearYield.fiftyTwoWeekLow}% – ${tenYearYield.fiftyTwoWeekHigh}%`);
  } else {
    lines.push(`10-Year Treasury Yield: Unavailable`);
  }

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
  const [vixResult, spyResult, fgResult, s5fiResult, fedResult, crudeOilResult, tenYearYieldResult] =
    await Promise.allSettled([
      fetchVix(),
      fetchSpy(),
      fetchFearGreed(),
      fetchS5fi(),
      fetchFedWatch(),
      fetchCrudeOil(),
      fetchTenYearYield(),
    ]);

  // ─── VIX ───
  let vixSignal;
  if (vixResult.status === "fulfilled") {
    const { vixPrice, vixPrevClose, closes } = vixResult.value;
    const change =
      Math.round((vixPrice - vixPrevClose) * 100) / 100;
    const labeled = labelVix(vixPrice);
    const vixTrend = computeVixTrend(closes);
    vixSignal = { value: vixPrice, change, vixTrend, ...labeled };
  } else {
    console.error("[api/macro] VIX fetch failed:", vixResult.reason?.message);
    vixSignal = {
      value: null,
      change: null,
      score: 3,
      label: "Unavailable",
      color: "amber",
      explanation: `VIX data unavailable: ${vixResult.reason?.message || "fetch failed"}`,
    };
  }

  // ─── SPY vs ATH ───
  let spySignal;
  if (spyResult.status === "fulfilled") {
    const { spyPrice, spyHigh } = spyResult.value;
    const pctFromHigh = (spyPrice - spyHigh) / spyHigh;
    const labeled = labelSpyVsAth(pctFromHigh);
    spySignal = {
      value: spyPrice,
      high: spyHigh,
      pctFromHigh: Math.round(pctFromHigh * 1000000) / 1000000,
      ...labeled,
    };
  } else {
    console.error("[api/macro] SPY fetch failed:", spyResult.reason?.message);
    spySignal = {
      value: null,
      high: null,
      pctFromHigh: null,
      score: 3,
      label: "Unavailable",
      color: "amber",
      explanation: `SPY data unavailable: ${spyResult.reason?.message || "fetch failed"}`,
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
    // Apply +0.5 score boost when 55% threshold is met (historically reliable cut signal)
    if (fed.threshold55Met) labeled.score = Math.min(5, labeled.score + 0.5);
    fedSignal = {
      cutsPricedIn: fed.cutsPricedIn,
      endOfYearImplied: fed.endOfYearImplied,
      currentRate: fed.currentRate,
      nextMeetingDate: fed.nextMeetingDate,
      weeklyChangeBps: fed.weeklyChangeBps,
      curveDirection: fed.curveDirection,
      probCut: fed.probCut,
      daysToNextMeeting: fed.daysToNextMeeting,
      isWithinWeek: fed.isWithinWeek,
      threshold55Met: fed.threshold55Met,
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
      probCut: null,
      daysToNextMeeting: null,
      isWithinWeek: false,
      threshold55Met: false,
      score: 2,
      label: "Unavailable",
      color: "amber",
      directionLabel: null,
      directionArrow: null,
      explanation: `FedWatch data unavailable: ${fedResult.reason?.message || "fetch failed"}`,
    };
  }

  // ─── Crude Oil ───
  let crudeOilSignal;
  if (crudeOilResult.status === "fulfilled") {
    const oil = crudeOilResult.value;
    const labeled = labelCrudeOil(oil.price);
    crudeOilSignal = { ...oil, ...labeled };
  } else {
    console.error("[api/macro] Crude Oil fetch failed:", crudeOilResult.reason?.message);
    crudeOilSignal = {
      price: null,
      change: null,
      changePct: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      score: 3,
      label: "Unavailable",
      color: "amber",
      explanation: `Crude Oil data unavailable: ${crudeOilResult.reason?.message || "fetch failed"}`,
    };
  }

  // ─── 10-Year Treasury Yield ───
  let tenYearYieldSignal;
  if (tenYearYieldResult.status === "fulfilled") {
    const yld = tenYearYieldResult.value;
    const labeled = labelTenYearYield(yld.yield);
    tenYearYieldSignal = { ...yld, ...labeled };
  } else {
    console.error("[api/macro] 10-Year Yield fetch failed:", tenYearYieldResult.reason?.message);
    tenYearYieldSignal = {
      yield: null,
      change: null,
      changePct: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      score: 3,
      label: "Unavailable",
      color: "amber",
      explanation: `10-Year Yield data unavailable: ${tenYearYieldResult.reason?.message || "fetch failed"}`,
    };
  }

  // ─── Composite posture ───
  const scores = [
    vixSignal.score,
    s5fiSignal.score,
    fgSignal.score,
    fedSignal.score,
    spySignal.score,
    crudeOilSignal.score,
    tenYearYieldSignal.score,
  ];
  const posture = computePosture(scores);

  const signals = {
    vix: vixSignal,
    s5fi: s5fiSignal,
    fearGreed: fgSignal,
    fedWatch: fedSignal,
    spyVsAth: spySignal,
    crudeOil: crudeOilSignal,
    tenYearYield: tenYearYieldSignal,
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
