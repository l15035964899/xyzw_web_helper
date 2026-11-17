export const DEFAULT_FAILED_TASK_RETRY_DELAY_MS = 30 * 60 * 1000;
export const AUTO_RETRY_TASK_KEYS = new Set([
  "batchLegacyClaim",
  "claimHangUpRewards",
  "resetBottles",
]);
const AUTO_RETRY_SOURCES = new Set(["nas-cron", "nas-scheduler"]);

function selectedTaskKeys(task) {
  const value = task?.selected_tasks || task?.task_types || [];
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function shouldRetryTaskAutomatically(task, source) {
  return (
    AUTO_RETRY_SOURCES.has(source) &&
    selectedTaskKeys(task).some((key) => AUTO_RETRY_TASK_KEYS.has(key))
  );
}

export function createFailedTaskRetryScheduler({
  dataStore,
  executeTask,
  addLog = () => {},
  delayMs = DEFAULT_FAILED_TASK_RETRY_DELAY_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const timers = new Map();

  function schedule({ task, tokenIds, source }) {
    if (!shouldRetryTaskAutomatically(task, source)) return null;
    const retryTokenIds = [...new Set((tokenIds || []).map(String))];
    if (retryTokenIds.length === 0) return null;
    if (timers.has(task.id)) {
      addLog("INFO", "taskRetry", `${task.name}: 已有等待中的失败重试`, {
        taskId: task.id,
      });
      return null;
    }

    const scheduledAtMs = now() + delayMs;
    const scheduledAt = new Date(scheduledAtMs).toISOString();
    const timer = setTimer(async () => {
      timers.delete(task.id);
      try {
        const currentTask = await dataStore.getTask(task.id);
        if (!currentTask?.enabled) {
          addLog(
            "INFO",
            "taskRetry",
            `${task.name}: 延迟重试取消，任务已停用或删除`,
            { taskId: task.id },
          );
          return;
        }
        const selected = new Set(
          (currentTask.selected_tokens || []).map(String),
        );
        const remainingIds = retryTokenIds.filter((id) => selected.has(id));
        if (remainingIds.length === 0) {
          addLog(
            "INFO",
            "taskRetry",
            `${task.name}: 延迟重试取消，失败账号已移出任务`,
            { taskId: task.id },
          );
          return;
        }
        addLog(
          "INFO",
          "taskRetry",
          `${task.name}: 开始重试 ${remainingIds.length} 个失败账号`,
          { taskId: task.id, source: "nas-retry" },
        );
        await executeTask(
          { ...currentTask, selected_tokens: remainingIds },
          { source: "nas-retry", retryAttempt: 1 },
        );
      } catch (error) {
        addLog(
          "ERROR",
          "taskRetry",
          `${task.name}: 延迟重试异常: ${error.message}`,
          { taskId: task.id, source: "nas-retry" },
        );
      }
    }, delayMs);
    timer.unref?.();
    timers.set(task.id, timer);

    addLog(
      "WARN",
      "taskRetry",
      `${task.name}: ${retryTokenIds.length} 个账号失败，将在 ${new Date(scheduledAtMs).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} 重试一次`,
      { taskId: task.id, source },
    );
    return { scheduledAt, tokenIds: retryTokenIds, delayMs };
  }

  function cancel(taskId) {
    const timer = timers.get(taskId);
    if (!timer) return false;
    clearTimer(timer);
    timers.delete(taskId);
    return true;
  }

  return {
    schedule,
    cancel,
    pendingTaskIds: () => [...timers.keys()],
  };
}
