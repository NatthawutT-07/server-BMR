/**
 * Date/time helper.
 *
 * Rule:
 * - Store Date values as UTC instants.
 * - Convert to Asia/Bangkok only for display or date-range boundaries.
 */

const BANGKOK_TIME_ZONE = "Asia/Bangkok";

/**
 * Get current time in Bangkok as ISO string with offset (+07:00)
 * Format: YYYY-MM-DDTHH:mm:ss+07:00
 */
const getBangkokNowISO = () => {
  return toBangkokOffsetISOString(new Date());
};

const toBangkokOffsetISOString = (value) => {
  if (!value) return null;

  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(d);
  const getPart = (type) => parts.find(p => p.type === type).value;
  const ms = String(d.getMilliseconds()).padStart(3, "0");

  return `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}:${getPart('second')}.${ms}+07:00`;
};

/**
 * Get the current instant for Prisma DateTime fields.
 * The returned Date is UTC internally; format it with Bangkok helpers for display.
 */
const getBangkokDate = () => {
  return new Date();
};

const normalizeLegacyBangkokStoredDate = (value) => {
  if (!value) return null;

  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  const fiveHoursMs = 5 * 60 * 60 * 1000;
  const sevenHoursMs = 7 * 60 * 60 * 1000;

  // Older sync rows were written as Bangkok wall-clock time into DateTime fields.
  // Prisma reads those values as UTC instants, making them appear about 7 hours in the future.
  if (d.getTime() - Date.now() > fiveHoursMs) {
    return new Date(d.getTime() - sevenHoursMs);
  }

  return d;
};

/**
 * Format any Date object or ISO string to BKK date string (YYYY-MM-DD)
 */
const toBkkDateStr = (dateObj) => {
  if (!dateObj) return null;
  const d = typeof dateObj === 'string' ? new Date(dateObj) : dateObj;
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BANGKOK_TIME_ZONE,
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
    timeZone: BANGKOK_TIME_ZONE,
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
  BANGKOK_TIME_ZONE,
  getBangkokNowISO,
  getBangkokDate,
  toBangkokOffsetISOString,
  normalizeLegacyBangkokStoredDate,
  toBkkDateStr,
  getBangkokDayStart,
  diffDays,
  getBangkokUtcRange,
  getBangkok90DaysRange
};
