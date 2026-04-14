// Black-Scholes option pricing and price target utilities.
// Pure functions, no imports, no side effects.

// ~4.5% — approximate current T-bill rate. Review quarterly.
export const RISK_FREE_RATE = 0.045;

/**
 * Cumulative standard normal distribution (Abramowitz & Stegun approximation).
 * Accurate to ~1e-7.
 */
export function normCDF(x) {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Black-Scholes European put price.
 * @param {number} S  - Current stock price
 * @param {number} K  - Strike price
 * @param {number} T  - Time to expiry in years (days / 365)
 * @param {number} r  - Risk-free rate (e.g. 0.045)
 * @param {number} iv - Implied volatility as decimal (e.g. 0.75 for 75%)
 * @returns {number}  - Estimated option price per share
 */
export function bsPutPrice(S, K, T, r, iv) {
  if (T <= 0) return Math.max(K - S, 0);

  const d1 = (Math.log(S / K) + (r + iv * iv / 2) * T) / (iv * Math.sqrt(T));
  const d2 = d1 - iv * Math.sqrt(T);

  return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
}

/**
 * Black-Scholes European call price.
 * @param {number} S  - Current stock price
 * @param {number} K  - Strike price
 * @param {number} T  - Time to expiry in years
 * @param {number} r  - Risk-free rate
 * @param {number} iv - Implied volatility as decimal
 * @returns {number}  - Estimated option price per share
 */
export function bsCallPrice(S, K, T, r, iv) {
  if (T <= 0) return Math.max(S - K, 0);

  const d1 = (Math.log(S / K) + (r + iv * iv / 2) * T) / (iv * Math.sqrt(T));
  const d2 = d1 - iv * Math.sqrt(T);

  return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
}

/**
 * Back-solve implied volatility from a market option price.
 * Given the current market mid for an option, finds the IV that makes
 * Black-Scholes match that price. This captures the real vol skew for
 * the specific strike, rather than using the equity-level IV.
 *
 * @param {number} marketMid  - Observed option mid price per share
 * @param {number} S          - Current stock price
 * @param {number} K          - Strike price
 * @param {number} T          - Time to expiry in years
 * @param {number} r          - Risk-free rate
 * @param {string} optionType - 'put' or 'call'
 * @returns {number|null}     - Implied vol as decimal, or null if no solution
 */
export function impliedVol(marketMid, S, K, T, r, optionType) {
  if (T <= 0 || marketMid <= 0) return null;

  const priceFn = optionType === "put" ? bsPutPrice : bsCallPrice;

  // Search IV between 5% and 500%
  let lo = 0.05, hi = 5.0;

  // Verify solution exists
  const loPrice = priceFn(S, K, T, r, lo);
  const hiPrice = priceFn(S, K, T, r, hi);
  const minPrice = Math.min(loPrice, hiPrice);
  const maxPrice = Math.max(loPrice, hiPrice);
  if (marketMid < minPrice || marketMid > maxPrice) return null;

  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const price = priceFn(S, K, T, r, mid);

    // Higher IV always means higher option price
    if (price < marketMid) lo = mid;
    else hi = mid;

    if (Math.abs(hi - lo) < 0.0001) break; // 0.01% precision
  }

  return (lo + hi) / 2;
}

/**
 * Find the stock price that produces a target option mid at a future date.
 * Uses binary search — converges in ~30-50 iterations to $0.01 precision.
 *
 * @param {number} targetMid    - Target option price per share
 * @param {number} K            - Strike price
 * @param {number} daysToTarget - Calendar days until target date
 * @param {number} r            - Risk-free rate
 * @param {number} iv           - Implied volatility (decimal)
 * @param {string} optionType   - 'put' or 'call'
 * @param {number} currentPrice - Current stock price (bounds the search)
 * @returns {number|null}       - Stock price, or null if no solution in range
 */
export function findStockPriceForTargetMid(
  targetMid, K, daysToTarget, r, iv, optionType, currentPrice
) {
  const T = daysToTarget / 365;
  const priceFn = optionType === "put" ? bsPutPrice : bsCallPrice;

  // Search bounds — generous range around current price
  const lo = currentPrice * 0.50;
  const hi = currentPrice * 1.50;

  // Verify solution exists within bounds
  const loPrice = priceFn(lo, K, T, r, iv);
  const hiPrice = priceFn(hi, K, T, r, iv);

  if (optionType === "put") {
    // Put price decreases as stock rises: loPrice >= hiPrice
    if (targetMid > loPrice || targetMid < hiPrice) return null;
  } else {
    // Call price increases as stock rises: loPrice <= hiPrice
    if (targetMid < loPrice || targetMid > hiPrice) return null;
  }

  // Binary search
  let low = lo, high = hi;
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    const price = priceFn(mid, K, T, r, iv);

    if (optionType === "put") {
      if (price > targetMid) low = mid;
      else high = mid;
    } else {
      if (price < targetMid) low = mid;
      else high = mid;
    }

    if (Math.abs(high - low) < 0.01) break;
  }

  return Math.round((low + high) / 2 * 100) / 100;
}

/**
 * Returns the next two Fridays from the given date.
 * If today is Friday after 4 PM ET (market close), skips to next Friday.
 */
export function getNextTwoFridays(fromDate) {
  const fridays = [];
  const d = new Date(fromDate);

  // Check if today is Friday after market close (4 PM ET)
  const etFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });
  const parts = etFormatter.formatToParts(fromDate);
  const etDay = parts.find(p => p.type === "weekday")?.value;
  const etHour = parseInt(parts.find(p => p.type === "hour")?.value, 10);

  const isFridayAfterClose = etDay === "Fri" && etHour >= 16;

  // Start from tomorrow (or day-after-tomorrow if Friday after close,
  // since tomorrow is Saturday anyway — the +1 handles both cases)
  d.setDate(d.getDate() + (isFridayAfterClose ? 2 : 1));

  while (fridays.length < 2) {
    if (d.getDay() === 5) fridays.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return fridays;
}

/**
 * Compute dynamic profit target and stock price targets for a position.
 *
 * @param {Object} position         - Position from positions table
 * @param {number|null} currentIV   - IV from equity quote (decimal, fallback)
 * @param {number|null} currentStockPrice - Current stock price
 * @param {number|null} currentMid  - Current option mid price (per share)
 * @param {number|null} optionIVFromGreeks - Per-strike IV from Public.com greeks API (preferred)
 * @returns {Object} Price target results
 */
export function computePriceTargets(position, currentIV, currentStockPrice, currentMid, optionIVFromGreeks) {
  const today = new Date();
  const openDate = new Date(position.open_date + "T00:00:00");
  const expiryDate = new Date(position.expiry_date + "T00:00:00");

  const originalDTE = Math.ceil((expiryDate - openDate) / (1000 * 60 * 60 * 24));
  const remainingDTE = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
  const dtePct = originalDTE > 0 ? Math.round((remainingDTE / originalDTE) * 100) : 0;

  // Dynamic profit target based on DTE band
  let targetProfitPct;
  if (dtePct > 80)      targetProfitPct = 50;
  else if (dtePct > 40) targetProfitPct = 60;
  else                  targetProfitPct = 80;

  // Premium per share
  const premiumPerShare = position.premium_collected / (position.contracts * 100);

  // Current P&L
  const currentProfitPct = currentMid != null
    ? Math.round((1 - (currentMid / premiumPerShare)) * 100)
    : null;

  // Target mid price — option value at which profit target is met
  const targetMid = premiumPerShare * (1 - targetProfitPct / 100);
  const breakEvenMid = premiumPerShare;

  // Status
  const isLosing = currentProfitPct != null && currentProfitPct < 0;
  const isOnTrack = currentProfitPct != null && currentProfitPct >= targetProfitPct * 0.5;

  const optionType = position.type === "CSP" ? "put" : "call";

  // IV priority: per-strike from greeks API > back-solved from market mid > equity-level
  const T = remainingDTE / 365;
  const backSolvedIV = (optionIVFromGreeks == null && currentMid != null && currentStockPrice != null)
    ? impliedVol(currentMid, currentStockPrice, position.strike, T, RISK_FREE_RATE, optionType)
    : null;
  const iv = optionIVFromGreeks ?? backSolvedIV ?? currentIV;

  // Bail early if we can't compute price targets
  if (iv == null || currentStockPrice == null) {
    return {
      originalDTE, remainingDTE, dtePct,
      targetProfitPct, currentProfitPct,
      premiumPerShare, targetMid,
      isOnTrack, isLosing,
      iv,
      targets: [],
    };
  }

  const fridays = getNextTwoFridays(today);

  const targets = fridays.map(friday => {
    const daysToFriday = Math.ceil((friday - today) / (1000 * 60 * 60 * 24));

    // Skip if Friday is at or past expiry
    if (daysToFriday >= remainingDTE) return null;

    // BS needs the option's remaining life ON that Friday, not days until Friday
    const dteOnFriday = remainingDTE - daysToFriday;

    const targetStockPrice = findStockPriceForTargetMid(
      targetMid, position.strike, dteOnFriday,
      RISK_FREE_RATE, iv, optionType, currentStockPrice
    );

    const breakEvenStockPrice = isLosing
      ? findStockPriceForTargetMid(
          breakEvenMid, position.strike, dteOnFriday,
          RISK_FREE_RATE, iv, optionType, currentStockPrice
        )
      : null;

    return {
      date: friday,
      daysAway: daysToFriday,
      targetStockPrice,
      breakEvenStockPrice,
    };
  }).filter(Boolean);

  return {
    originalDTE, remainingDTE, dtePct,
    targetProfitPct, currentProfitPct,
    premiumPerShare, targetMid,
    isOnTrack, isLosing,
    iv,
    targets,
  };
}
