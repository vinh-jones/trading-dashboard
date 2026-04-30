/**
 * Converts a date range preset + optional custom range into a [start, end] Date pair.
 * @param {string} preset  - 'ytd' | '1m' | '3m' | '1y' | 'all' | 'custom'
 * @param {{ start: Date, end: Date } | null} customRange
 * @returns {[Date, Date]}
 */
export function resolvePreset(preset, customRange) {
  const today = new Date();
  today.setHours(23, 59, 59, 999); // end of today

  switch (preset) {
    case "1m": {
      const start = new Date(today);
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      return [start, today];
    }
    case "3m": {
      const start = new Date(today);
      start.setDate(start.getDate() - 90);
      start.setHours(0, 0, 0, 0);
      return [start, today];
    }
    case "1y": {
      const start = new Date(today);
      start.setFullYear(start.getFullYear() - 1);
      start.setHours(0, 0, 0, 0);
      return [start, today];
    }
    case "all": {
      return [new Date(0), today];
    }
    case "custom": {
      if (!customRange) {
        // Fall back to ytd until user picks a range
        const start = new Date(today.getFullYear(), 0, 1, 0, 0, 0, 0);
        return [start, today];
      }
      const end = new Date(customRange.end);
      end.setHours(23, 59, 59, 999);
      return [customRange.start, end];
    }
    case "ytd":
    default: {
      const start = new Date(today.getFullYear(), 0, 1, 0, 0, 0, 0);
      return [start, today];
    }
  }
}
