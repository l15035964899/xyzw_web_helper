const MONTH_NAMES = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const WEEKDAY_NAMES = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const WEEKDAY_FROM_NAME = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function parseValue(text, aliases) {
  const upper = String(text || "")
    .trim()
    .toUpperCase();
  if (Object.hasOwn(aliases, upper)) return aliases[upper];
  const value = Number(upper);
  return Number.isInteger(value) ? value : null;
}

/**
 * Expand one five-field cron field into its matching numeric values.
 * @param {string} field Cron field text.
 * @param {number} min Minimum accepted value.
 * @param {number} max Maximum accepted value.
 * @param {object} aliases Optional month or weekday names.
 * @returns {Set<number>} Matching values.
 */
export function expandCronField(field, min, max, aliases = {}) {
  const values = new Set();
  const parts = String(field || "").split(",");
  for (const part of parts) {
    let expression = part.trim();
    let step = 1;
    const slash = expression.indexOf("/");
    if (slash >= 0) {
      step = Number(expression.slice(slash + 1));
      expression = expression.slice(0, slash);
      if (!Number.isInteger(step) || step <= 0) return new Set();
    }

    let start;
    let end;
    if (expression === "*" || expression === "?") {
      start = min;
      end = max;
    } else if (expression.includes("-")) {
      const [startText, endText] = expression.split("-");
      start = parseValue(startText, aliases);
      end = parseValue(endText, aliases);
    } else {
      start = parseValue(expression, aliases);
      end = slash >= 0 ? max : start;
    }

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      return new Set();
    }
    for (let value = start; value <= end; value += step) {
      values.add(value === 7 && max === 7 ? 0 : value);
    }
  }
  return values;
}

function shanghaiParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAY_FROM_NAME[parts.weekday],
  };
}

/**
 * Find the next cron occurrence in a specific IANA time zone.
 * Supports numbers, ranges, lists, steps, and English month/weekday names.
 * @param {string} expression Five-field cron expression.
 * @param {object} options Time source and display time zone.
 * @param {Date} options.now Current instant used as the search start.
 * @param {string} options.timeZone IANA time zone used to match cron fields.
 * @returns {Date|null} Next occurrence, or null for an unsupported expression.
 */
export function getNextCronRun(
  expression,
  { now = new Date(), timeZone = "Asia/Shanghai" } = {},
) {
  const fields = String(expression || "")
    .trim()
    .split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  const minutes = expandCronField(minuteField, 0, 59);
  const hours = expandCronField(hourField, 0, 23);
  const days = expandCronField(dayField, 1, 31);
  const months = expandCronField(monthField, 1, 12, MONTH_NAMES);
  const weekdays = expandCronField(weekdayField, 0, 7, WEEKDAY_NAMES);
  if (
    !minutes.size ||
    !hours.size ||
    !days.size ||
    !months.size ||
    !weekdays.size
  ) {
    return null;
  }

  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);
  const limit = candidate.getTime() + 366 * 24 * 60 * 60 * 1000;
  const dayIsAny = dayField === "*" || dayField === "?";
  const weekdayIsAny = weekdayField === "*" || weekdayField === "?";

  while (candidate.getTime() <= limit) {
    const parts = shanghaiParts(candidate, timeZone);
    const monthMatches = months.has(parts.month);
    const dayMatches = days.has(parts.day);
    const weekdayMatches = weekdays.has(parts.weekday);
    let dateMatches;
    if (dayIsAny && weekdayIsAny) dateMatches = true;
    else if (dayIsAny) dateMatches = weekdayMatches;
    else if (weekdayIsAny) dateMatches = dayMatches;
    else dateMatches = dayMatches || weekdayMatches;

    if (
      monthMatches &&
      dateMatches &&
      hours.has(parts.hour) &&
      minutes.has(parts.minute)
    ) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

export function formatCronRun(date, timeZone = "Asia/Shanghai") {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
