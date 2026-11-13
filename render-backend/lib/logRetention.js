const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Return the instant at which the current Shanghai calendar day starts.
 * Logs older than this boundary belong to previous days and should be removed.
 */
export function getShanghaiDayStart(now = new Date()) {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ) - SHANGHAI_OFFSET_MS,
  );
}

/**
 * Keep today's and yesterday's task logs. At Shanghai midnight, remove logs
 * before yesterday's start so the two most recent calendar days remain.
 */
export function getShanghaiLogRetentionCutoff(now = new Date()) {
  return new Date(getShanghaiDayStart(now).getTime() - DAY_MS);
}
