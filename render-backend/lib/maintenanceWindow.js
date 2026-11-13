const MAINTENANCE_START_MINUTE = 5 * 60;
const MAINTENANCE_RESUME_MINUTE = 7 * 60 + 5;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function shanghaiParts(date) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
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
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: values.weekday,
  };
}

/**
 * Calculate how long a Friday task should wait for the 05:00-07:00 maintenance.
 * Tasks resume at 07:05 Asia/Shanghai to allow the game service to stabilize.
 * @param {Date} now Current instant.
 * @returns {{delayMs:number,resumeAt:Date|null}} Wait duration and resume time.
 */
export function getMaintenanceDelay(now = new Date()) {
  const parts = shanghaiParts(now);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  if (
    parts.weekday !== "Fri" ||
    minuteOfDay < MAINTENANCE_START_MINUTE ||
    minuteOfDay >= MAINTENANCE_RESUME_MINUTE
  ) {
    return { delayMs: 0, resumeAt: null };
  }

  const resumeAt = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, 7, 5) - SHANGHAI_OFFSET_MS,
  );
  return {
    delayMs: Math.max(0, resumeAt.getTime() - now.getTime()),
    resumeAt,
  };
}
