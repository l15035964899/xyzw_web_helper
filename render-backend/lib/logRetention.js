const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

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
