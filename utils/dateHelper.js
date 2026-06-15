const BANGKOK_TIME_ZONE = "Asia/Bangkok";

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

const getBangkokDate = () => {
  return new Date();
};

const normalizeLegacyBangkokStoredDate = (value) => {
  if (!value) return null;

  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  const fiveHoursMs = 5 * 60 * 60 * 1000;
  const sevenHoursMs = 7 * 60 * 60 * 1000;

  if (d.getTime() - Date.now() > fiveHoursMs) {
    return new Date(d.getTime() - sevenHoursMs);
  }

  return d;
};

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

const getBangkokDayStart = (isoOrDate) => {
  const dateStr = toBkkDateStr(isoOrDate);
  if (!dateStr) return null;
  return new Date(`${dateStr}T00:00:00+07:00`);
};

const diffDays = (end, start) => {
  const d1 = getBangkokDayStart(end);
  const d2 = getBangkokDayStart(start);
  if (!d1 || !d2) return 0;
  return Math.max(0, Math.floor((d1 - d2) / 86400000));
};

const getBangkokUtcRange = (startStr, endStr) => {
  const start = new Date(startStr + "T00:00:00+07:00");
  const end = new Date(endStr + "T23:59:59.999+07:00");
  return { startUtc: start, endUtc: end };
};

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

  const endBkk = new Date(Date.UTC(bkkYear, bkkMonth - 1, bkkDay, 0, 0, 0, 0));
  endBkk.setUTCDate(endBkk.getUTCDate() - 1);
  
  const startBkk = new Date(endBkk);
  startBkk.setUTCDate(startBkk.getUTCDate() - 89);

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
