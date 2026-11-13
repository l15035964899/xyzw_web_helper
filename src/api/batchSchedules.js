import {
  loadServerConnection,
  serverRequest,
} from "@/api/serverTasks";

export function requestBatchServer(path, options = {}) {
  return serverRequest(path, {
    ...loadServerConnection(),
    ...options,
  });
}

function normalizeArray(value) {
  if (Array.isArray(value)) return [...value];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function inferDailyRun(cronExpression = "") {
  const match = String(cronExpression)
    .trim()
    .match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (!match) return null;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute > 59 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function dailyTimeToCron(runTime) {
  const match = String(runTime || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new Error("每天运行时间格式无效");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("每天运行时间超出范围");
  return `${minute} ${hour} * * *`;
}

export function serverTaskToUi(task = {}) {
  const cronExpression =
    task.cron_expr || task.cron_expression || task.cron || "0 8 * * *";
  const inferredDaily = inferDailyRun(cronExpression);
  const runType =
    task.schedule_type === "daily" ||
    (!task.schedule_type && inferredDaily)
      ? "daily"
      : "cron";
  return {
    ...task,
    id: task.id,
    legacyId: task.legacy_id || null,
    name: task.name || "未命名任务",
    runType,
    runTime:
      task.run_time || (runType === "daily" ? inferredDaily : undefined),
    cronExpression: runType === "cron" ? cronExpression : "",
    selectedTokens: normalizeArray(task.selected_tokens || task.token_ids),
    selectedTasks: normalizeArray(
      task.selected_tasks || task.task_type,
    ),
    legionApplyTargetId: Number(task.options?.legionId || 0) || null,
    serverOptions:
      task.options && typeof task.options === "object" ? { ...task.options } : {},
    enabled: Boolean(task.enabled),
    lastRunAt: task.last_run_at || null,
    nextRunAt: task.next_run_at || null,
    running: Boolean(task.running),
  };
}

export function uiTaskToServer(task, { existingOptions = {} } = {}) {
  const cronExpression =
    task.runType === "daily"
      ? dailyTimeToCron(task.runTime)
      : String(task.cronExpression || "").trim();
  const options = {
    ...existingOptions,
  };
  const legionId = Number(task.legionApplyTargetId || 0);
  if (legionId > 0) options.legionId = legionId;
  else delete options.legionId;

  return {
    id: task.id || undefined,
    name: String(task.name || "").trim(),
    schedule_type: task.runType,
    run_time: task.runType === "daily" ? task.runTime : null,
    cron_expr: cronExpression,
    selected_tasks: [...task.selectedTasks],
    selected_tokens: [...task.selectedTokens],
    options,
    enabled: Boolean(task.enabled),
    source: "batch-daily",
    legacy_id: task.legacyId || null,
  };
}

export async function loadServerSchedules(request = requestBatchServer) {
  const tasks = await request("/api/tasks");
  return (Array.isArray(tasks) ? tasks : []).map(serverTaskToUi);
}

export async function saveServerSchedule(
  task,
  { taskId = null, existingOptions = {}, request = requestBatchServer } = {},
) {
  const body = uiTaskToServer(task, { existingOptions });
  const path = taskId
    ? `/api/tasks/${encodeURIComponent(taskId)}`
    : "/api/tasks";
  const [saved] = await request(path, {
    method: taskId ? "PATCH" : "POST",
    body,
  });
  return saved;
}

export async function deleteServerSchedule(
  taskId,
  request = requestBatchServer,
) {
  return request(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
}

export async function setServerScheduleEnabled(
  taskId,
  enabled,
  request = requestBatchServer,
) {
  const [saved] = await request(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "PATCH",
      body: { enabled: Boolean(enabled) },
    },
  );
  return saved;
}

export async function runServerSchedule(
  taskId,
  request = requestBatchServer,
) {
  return request(`/api/tasks/${encodeURIComponent(taskId)}/run`, {
    method: "POST",
    body: {},
  });
}

export async function previewServerCron(
  cronExpression,
  request = requestBatchServer,
) {
  return request("/api/cron/preview", {
    method: "POST",
    body: { cron_expr: cronExpression, count: 5 },
  });
}

export async function loadServerBatchSettings(
  request = requestBatchServer,
) {
  return request("/api/batch-settings");
}

export async function saveServerBatchSettings(
  settings,
  request = requestBatchServer,
) {
  return request("/api/batch-settings", {
    method: "PATCH",
    body: settings,
  });
}

export async function loadServerTaskRuntime(
  request = requestBatchServer,
) {
  return request("/api/tasks/runtime");
}

export async function loadServerTaskLogs(
  { limit = 100, status = null, taskId = null, runId = null } = {},
  request = requestBatchServer,
) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (status) query.set("status", status);
  if (taskId) query.set("task_id", taskId);
  if (runId) query.set("run_id", runId);
  return request(`/api/logs/db?${query.toString()}`);
}
