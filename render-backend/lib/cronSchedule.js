import cron from "node-cron";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const SEARCH_LIMIT_MS = 366 * 24 * 60 * 60 * 1000;

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

function parseValue(text, aliases) {
  const value = String(text || "")
    .trim()
    .toUpperCase();
  if (Object.hasOwn(aliases, value)) return aliases[value];
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Expand a standard five-field cron component into numeric values.
 * Extended Quartz syntax such as L, W and # is intentionally unsupported.
 */
export function expandCronField(field, min, max, aliases = {}) {
  if (!field || field.includes("#")) return new Set();
  const values = new Set();

  for (const part of String(field).split(",")) {
    const [rangeText, stepText, extra] = part.trim().split("/");
    if (extra !== undefined) return new Set();
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step <= 0) return new Set();

    let start;
    let end;
    if (rangeText === "*" || rangeText === "?") {
      start = min;
      end = max;
    } else if (rangeText.includes("-")) {
      const range = rangeText.split("-");
      if (range.length !== 2) return new Set();
      start = parseValue(range[0], aliases);
      end = parseValue(range[1], aliases);
    } else {
      start = parseValue(rangeText, aliases);
      end = stepText === undefined ? start : max;
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

function shanghaiParts(date) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return {
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/**
 * Return the next matching cron instants in Shanghai time.
 * @param {string} expression Five-field cron expression.
 * @param {object} options Search options.
 * @param {Date} options.now Search start.
 * @param {number} options.count Number of matches to return.
 * @returns {Date[]} Matching instants.
 */
export function getNextCronRuns(
  expression,
  { now = new Date(), count = 5 } = {},
) {
  const fields = String(expression || "")
    .trim()
    .split(/\s+/);
  if (fields.length !== 5) return [];

  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  if (/[LW]/i.test(dayField) || /[L#]/i.test(weekdayField)) return [];
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
    return [];
  }

  const want = Math.max(1, Math.min(20, Number(count) || 5));
  const dayIsAny = dayField === "*" || dayField === "?";
  const weekdayIsAny = weekdayField === "*" || weekdayField === "?";
  const results = [];
  let candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate = new Date(candidate.getTime() + MINUTE_MS);
  const limit = candidate.getTime() + SEARCH_LIMIT_MS;

  while (candidate.getTime() <= limit && results.length < want) {
    const parts = shanghaiParts(candidate);
    const dayMatches = days.has(parts.day);
    const weekdayMatches = weekdays.has(parts.weekday);
    let dateMatches;
    if (dayIsAny && weekdayIsAny) dateMatches = true;
    else if (dayIsAny) dateMatches = weekdayMatches;
    else if (weekdayIsAny) dateMatches = dayMatches;
    else dateMatches = dayMatches || weekdayMatches;

    if (
      months.has(parts.month) &&
      dateMatches &&
      hours.has(parts.hour) &&
      minutes.has(parts.minute)
    ) {
      results.push(candidate);
    }
    candidate = new Date(candidate.getTime() + MINUTE_MS);
  }

  return results;
}

export function getNextCronRun(expression, options = {}) {
  return getNextCronRuns(expression, { ...options, count: 1 })[0] || null;
}

/**
 * Validate using node-cron and verify that the UI preview parser supports it.
 */
export function previewCronExpression(expression, options = {}) {
  const normalized = String(expression || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cron.validate(normalized)) {
    return {
      valid: false,
      normalized,
      message: "Cron 表达式无效",
      nextRuns: [],
    };
  }

  const nextRuns = getNextCronRuns(normalized, options);
  if (nextRuns.length === 0) {
    return {
      valid: false,
      normalized,
      message: "暂不支持该扩展 Cron 语法，请使用标准五字段表达式",
      nextRuns: [],
    };
  }

  return {
    valid: true,
    normalized,
    message: "Cron 表达式有效",
    nextRuns: nextRuns.map((date) => date.toISOString()),
  };
}
