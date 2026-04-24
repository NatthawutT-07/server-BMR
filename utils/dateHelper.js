/**
 * Helper for Thailand Timezone (+07:00)
 */

/**
 * Get the date range for the last 90 days ending yesterday (BKK time).
 * Returns { startUtc, endUtc, startDateStr, endDateStr }
 */
const getBangkok90DaysRange = () => {
  const now = new Date();
  
  // Format to BKK time string to get today's date in Thailand
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find(p => p.type === type).value;
  
  const bkkYear = parseInt(getPart("year"));
  const bkkMonth = parseInt(getPart("month"));
  const bkkDay = parseInt(getPart("day"));

  // Yesterday BKK
  const endBkk = new Date(Date.UTC(bkkYear, bkkMonth - 1, bkkDay, 0, 0, 0, 0));
  endBkk.setUTCDate(endBkk.getUTCDate() - 1);
  
  const startBkk = new Date(endBkk);
  startBkk.setUTCDate(startBkk.getUTCDate() - 89);

  // UTC equivalents
  // BKK 00:00:00 -> UTC yesterday 17:00:00
  // But usually we want the full day in BKK as UTC range
  const startUtc = new Date(startBkk.getTime() - 7 * 60 * 60 * 1000);
  const endUtc = new Date(endBkk.getTime() + (23 * 60 * 60 * 1000) + (59 * 60 * 1000) + (59 * 1000) + 999 - 7 * 60 * 60 * 1000);

  const formatYMD = (d) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  return {
    startUtc,
    endUtc,
    startDateStr: formatYMD(startBkk),
    endDateStr: formatYMD(endBkk)
  };
};

/**
 * Format a Date object to BKK date string (YYYY-MM-DD)
 */
const toBkkDateStr = (dateObj) => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dateObj);
};

/**
 * Convert BKK date strings (YYYY-MM-DD) to UTC Date objects for Prisma queries.
 * @param {string} startStr - 'YYYY-MM-DD'
 * @param {string} endStr - 'YYYY-MM-DD'
 * @returns {{startUtc: Date, endUtc: Date}}
 */
const getBangkokUtcRange = (startStr, endStr) => {
  const start = new Date(startStr + "T00:00:00+07:00");
  const end = new Date(endStr + "T23:59:59.999+07:00");
  return { startUtc: start, endUtc: end };
};

module.exports = {
  getBangkok90DaysRange,
  toBkkDateStr,
  getBangkokUtcRange
};
