const PUSH_STATUSES = new Set([
  "queued",
  "running",
  "waiting-scheduled-task",
  "waiting-relogin",
  "waiting-manual-torch",
  "paused",
  "stopping",
  "stopped",
  "failed",
]);

const ACTIVE_PUSH_STATUSES = new Set([
  "queued",
  "running",
  "waiting-scheduled-task",
  "waiting-relogin",
  "waiting-manual-torch",
  "paused",
]);

const ACCOUNT_STATUSES = new Set([
  "queued",
  "connecting",
  "idle",
  "calculating",
  "fighting",
  "settling",
  "waiting",
  "waiting-scheduled-task",
  "waiting-relogin",
  "paused",
  "stopped",
  "failed",
]);

export const DEFAULT_PUSH_OPTIONS = Object.freeze({
  maxConcurrent: 5,
  maxRetries: 999999,
  retryDelaySeconds: 3,
  battleIntervalSeconds: 2,
  battleTimeCapSeconds: 1800,
  autoContinue: true,
  autoUpgradeHangup: true,
  kickReloginDelayMinutes: 5,
});

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function booleanValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === "1" || value === "true";
}

function timestamp(value, fallback = null) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

export function normalizePushOptions(input = {}) {
  return {
    maxConcurrent: boundedInteger(
      input.maxConcurrent,
      DEFAULT_PUSH_OPTIONS.maxConcurrent,
      1,
      5,
    ),
    maxRetries: boundedInteger(
      input.maxRetries,
      DEFAULT_PUSH_OPTIONS.maxRetries,
      1,
      999999,
    ),
    retryDelaySeconds: boundedInteger(
      input.retryDelaySeconds,
      DEFAULT_PUSH_OPTIONS.retryDelaySeconds,
      1,
      60,
    ),
    battleIntervalSeconds: boundedInteger(
      input.battleIntervalSeconds,
      DEFAULT_PUSH_OPTIONS.battleIntervalSeconds,
      1,
      60,
    ),
    battleTimeCapSeconds: boundedInteger(
      input.battleTimeCapSeconds,
      DEFAULT_PUSH_OPTIONS.battleTimeCapSeconds,
      60,
      7200,
    ),
    autoContinue: booleanValue(
      input.autoContinue,
      DEFAULT_PUSH_OPTIONS.autoContinue,
    ),
    autoUpgradeHangup: booleanValue(
      input.autoUpgradeHangup,
      DEFAULT_PUSH_OPTIONS.autoUpgradeHangup,
    ),
    kickReloginDelayMinutes: boundedInteger(
      input.kickReloginDelayMinutes,
      DEFAULT_PUSH_OPTIONS.kickReloginDelayMinutes,
      0,
      120,
    ),
  };
}

export function createPushAccountState(input = {}) {
  const now = new Date().toISOString();
  return {
    tokenId: String(input.tokenId || ""),
    tokenName: String(input.tokenName || input.tokenId || "未知账号"),
    status: ACCOUNT_STATUSES.has(input.status) ? input.status : "queued",
    level: Math.max(0, boundedInteger(input.level, 0, 0, 9999999)),
    bossName: String(input.bossName || ""),
    battleVersion: input.battleVersion ?? null,
    battleTime: Math.max(0, Number(input.battleTime) || 0),
    battleStartedAt: timestamp(input.battleStartedAt),
    lastSettlementAt: timestamp(input.lastSettlementAt),
    battles: Math.max(0, Number(input.battles) || 0),
    wins: Math.max(0, Number(input.wins) || 0),
    losses: Math.max(0, Number(input.losses) || 0),
    retries: Math.max(0, Number(input.retries) || 0),
    consecutiveErrors: Math.max(0, Number(input.consecutiveErrors) || 0),
    lastError: String(input.lastError || ""),
    torchType: Math.max(0, Number(input.torchType) || 0),
    torchRemaining: Math.max(0, Number(input.torchRemaining) || 0),
    torchSettleTime: Math.max(0, Number(input.torchSettleTime) || 0),
    kickedAt: timestamp(input.kickedAt),
    reloginAt: timestamp(input.reloginAt),
    kickCount: Math.max(0, Number(input.kickCount) || 0),
    lastRunAt: timestamp(input.lastRunAt),
    lastHeartbeatAt: timestamp(input.lastHeartbeatAt),
    updatedAt: timestamp(input.updatedAt, now),
  };
}

export function createPushRunState({
  runId,
  tokenIds = [],
  accounts = {},
  options,
  requestedBy = "nas-manual",
  now = new Date().toISOString(),
}) {
  const ids = [...new Set(tokenIds.map(String).filter(Boolean))];
  return {
    version: 1,
    runId: String(runId),
    taskId: `pushing:${runId}`,
    status: "queued",
    requestedBy: String(requestedBy || "nas-manual"),
    createdAt: now,
    startedAt: null,
    stoppedAt: null,
    stopReason: "",
    stopRequested: false,
    pauseReason: "",
    options: normalizePushOptions(options),
    tokenIds: ids,
    accounts: Object.fromEntries(
      ids.map((tokenId) => [
        tokenId,
        createPushAccountState({
          ...(accounts[tokenId] || {}),
          tokenId,
        }),
      ]),
    ),
    lastTorchResult: null,
    updatedAt: now,
  };
}

export function normalizePushRunState(input = {}) {
  const runId = String(input.runId || input.id || "");
  const tokenIds = Array.isArray(input.tokenIds)
    ? [...new Set(input.tokenIds.map(String).filter(Boolean))]
    : Object.keys(input.accounts || {});
  const accounts = Object.fromEntries(
    tokenIds.map((tokenId) => [
      tokenId,
      createPushAccountState({
        ...(input.accounts?.[tokenId] || {}),
        tokenId,
      }),
    ]),
  );
  return {
    version: 1,
    runId,
    taskId: String(input.taskId || `pushing:${runId}`),
    status: PUSH_STATUSES.has(input.status) ? input.status : "queued",
    requestedBy: String(input.requestedBy || "nas-manual"),
    createdAt: timestamp(input.createdAt, new Date().toISOString()),
    startedAt: timestamp(input.startedAt),
    stoppedAt: timestamp(input.stoppedAt),
    stopReason: String(input.stopReason || ""),
    stopRequested: Boolean(input.stopRequested),
    pauseReason: String(input.pauseReason || ""),
    options: normalizePushOptions(input.options),
    tokenIds,
    accounts,
    lastTorchResult:
      input.lastTorchResult && typeof input.lastTorchResult === "object"
        ? { ...input.lastTorchResult }
        : null,
    updatedAt: timestamp(input.updatedAt, new Date().toISOString()),
  };
}

export function isActivePushStatus(status) {
  return ACTIVE_PUSH_STATUSES.has(String(status));
}

export function isTerminalPushStatus(status) {
  return ["stopped", "failed"].includes(String(status));
}

export function normalizePushLog(entry = {}) {
  const level = String(entry.level || entry.status || "info").toLowerCase();
  return {
    id: String(entry.id || ""),
    runId: String(entry.run_id || entry.runId || ""),
    taskType: entry.task_type || null,
    tokenId: entry.token_id ? String(entry.token_id) : null,
    tokenName: entry.token_name || null,
    level: level === "warn" ? "warning" : level,
    message: String(entry.message || ""),
    createdAt: timestamp(entry.created_at, new Date().toISOString()),
  };
}
