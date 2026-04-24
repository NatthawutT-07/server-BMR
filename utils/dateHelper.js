/**
 * Helper for Thailand Timezone (+07:00)
 * Centralizes all date/time logic to ensure consistency across dev and server environments.
 */

/**
 * Get current time in Bangkok as ISO string with offset (+07:00)
 * Format: YYYY-MM-DDTHH:mm:ss+07:00
 */
const getBangkokNowISO = () => {
  const d = new Date();
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(d);
  const getPart = (type) => parts.find(p => p.type === type).value;
  return `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}:${getPart('second')}+07:00`;
};

/**
 * Get current date in Bangkok (Date object representing BKK time)
 * Useful for Prisma fields that expect a Date object.
 */
const getBangkokDate = () => {
  return new Date(getBangkokNowISO());
};

/**
 * Format any Date object or ISO string to BKK date string (YYYY-MM-DD)
 */
const toBkkDateStr = (dateObj) => {
  if (!dateObj) return null;
  const d = typeof dateObj === 'string' ? new Date(dateObj) : dateObj;
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
};

/**
 * Get Date object for start of day in Bangkok (00:00:00+07:00)
 */
const getBangkokDayStart = (isoOrDate) => {
  const dateStr = toBkkDateStr(isoOrDate);
  if (!dateStr) return null;
  return new Date(`${dateStr}T00:00:00+07:00`);
};

/**
 * Calculate difference in days between two BKK dates
 */
const diffDays = (end, start) => {
  const d1 = getBangkokDayStart(end);
  const d2 = getBangkokDayStart(start);
  if (!d1 || !d2) return 0;
  return Math.max(0, Math.floor((d1 - d2) / 86400000));
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

/**
 * Get the date range for the last 90 days ending yesterday (BKK time).
 * Returns { startUtc, endUtc, startDateStr, endDateStr }
 */
const getBangkok90DaysRange = () => {
  const now = new Date();
  
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
  const startUtc = new Date(startBkk.getTime() - 7 * 60 * 60 * 1000);
  const endUtc = new Date(endBkk.getTime() + (23 * 60 * 60 * 1000) + (59 * 60 * 1000) + (59 * 1000) + 999 - 7 * 60 * 60 * 1000);

  return {
    startUtc,
    endUtc,
    startDateStr: toBkkDateStr(startBkk),
    endDateStr: toBkkDateStr(endBkk)
  };
};

module.exports = {
  getBangkokNowISO,
  getBangkokDate,
  toBkkDateStr,
  getBangkokDayStart,
  diffDays,
  getBangkokUtcRange,
  getBangkok90DaysRange
};
