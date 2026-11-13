function safeNextRun(task, getNextRunMs) {
  if (!task.enabled) return Number.POSITIVE_INFINITY;
  const value = Number(getNextRunMs?.(task));
  return Number.isFinite(value) && value > 0
    ? value
    : Number.POSITIVE_INFINITY;
}

/**
 * Sort enabled schedules by their next execution time and keep disabled or
 * uncomputable schedules at the bottom.
 */
export function sortScheduledTasks(tasks, getNextRunMs) {
  return [...tasks].sort((left, right) => {
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
    const leftNext = safeNextRun(left, getNextRunMs);
    const rightNext = safeNextRun(right, getNextRunMs);
    if (leftNext !== rightNext) return leftNext - rightNext;
    return String(left.name || "").localeCompare(
      String(right.name || ""),
      "zh-CN",
    );
  });
}
