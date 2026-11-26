import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { normalizeBatchSettings } from "./batchSettings.js";

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeEnabled(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === "1" || value === "true";
}

function normalizeOptions(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function normalizeToken(input = {}) {
  const now = new Date().toISOString();
  const token =
    typeof input.token === "string"
      ? input.token
      : JSON.stringify(input.token || {});
  return {
    ...input,
    id: input.id || randomUUID(),
    name: String(input.name || input.roleId || "未命名角色"),
    token,
    roleId: input.roleId ?? input.role_id ?? null,
    sessId: input.sessId ?? input.sess_id ?? null,
    connId: input.connId ?? input.conn_id ?? null,
    isRestore: input.isRestore ?? input.is_restore ?? 0,
    ws_url: input.ws_url ?? input.wsUrl ?? null,
    server: input.server ?? null,
    daily_settings: input.daily_settings ?? null,
    enabled: normalizeEnabled(input.enabled),
    created_at: input.created_at || now,
    updated_at: now,
  };
}

function readTokenPayload(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function sessionConnId(value, fallback = null) {
  const payload = readTokenPayload(value);
  const connId = Number(payload.connId ?? fallback);
  return Number.isFinite(connId) && connId > 1e12 ? connId : null;
}

function preserveNewerSession(current, patch) {
  if (!Object.hasOwn(patch, "token")) return patch;
  const currentConnId = sessionConnId(current.token, current.connId);
  const incomingConnId = sessionConnId(patch.token, patch.connId);
  if (
    currentConnId != null &&
    (incomingConnId == null || incomingConnId < currentConnId)
  ) {
    return {
      ...patch,
      token: current.token,
      sessId: current.sessId,
      connId: current.connId,
      isRestore: current.isRestore,
    };
  }
  return patch;
}

function normalizeTask(input = {}) {
  const now = new Date().toISOString();
  return {
    ...input,
    id: input.id || randomUUID(),
    name: String(input.name || "未命名任务"),
    cron_expr:
      input.cron_expr || input.cron_expression || input.cron || "0 8 * * *",
    selected_tasks: normalizeArray(
      input.selected_tasks || input.task_types || input.task_type,
    ),
    selected_tokens: normalizeArray(
      input.selected_tokens || input.token_ids || input.connectedTokens,
    ),
    options: normalizeOptions(input.options || input.task_options),
    enabled: normalizeEnabled(input.enabled),
    last_run_at: input.last_run_at || null,
    created_at: input.created_at || now,
    updated_at: now,
  };
}

function sortByCreatedAt(items) {
  return items.sort(
    (left, right) =>
      new Date(left.created_at || 0).getTime() -
      new Date(right.created_at || 0).getTime(),
  );
}

export function createLocalStore({ dataDir }) {
  const root = path.resolve(dataDir || "/data");
  const tokensFile = path.join(root, "tokens.json");
  const tasksFile = path.join(root, "cron-tasks.json");
  const batchSettingsFile = path.join(root, "batch-settings.json");
  const logsFile = path.join(root, "task-logs.jsonl");
  const tokenRefreshCredentialsFile = path.join(
    root,
    "token-refresh-credentials.json",
  );
  const nightmareRunsFile = path.join(root, "nightmare-runs.json");
  let writeQueue = Promise.resolve();

  async function readJson(file, fallback) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return fallback;
      throw error;
    }
  }

  async function writeJson(file, value) {
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600);
  }

  function mutate(operation) {
    const execute = async () => operation();
    const result = writeQueue.then(execute, execute);
    writeQueue = result.catch(() => {});
    return result;
  }

  async function listTokens({ enabledOnly = false } = {}) {
    const values = await readJson(tokensFile, []);
    const tokens = Array.isArray(values) ? values.map(normalizeToken) : [];
    return sortByCreatedAt(
      enabledOnly ? tokens.filter((token) => token.enabled) : tokens,
    );
  }

  async function getToken(id) {
    return (await listTokens()).find((token) => token.id === id) || null;
  }

  async function createToken(input) {
    return mutate(async () => {
      const current = await listTokens();
      const token = normalizeToken(input);
      const existing = current.findIndex((entry) => entry.id === token.id);
      let saved;
      if (existing >= 0) {
        const patch = preserveNewerSession(current[existing], token);
        current[existing] = normalizeToken({
          ...current[existing],
          ...patch,
          id: token.id,
          created_at: current[existing].created_at,
        });
        saved = current[existing];
      } else {
        current.push(token);
        saved = token;
      }
      await writeJson(tokensFile, current);
      return saved;
    });
  }

  async function updateToken(id, patch) {
    return mutate(async () => {
      const current = await listTokens();
      const index = current.findIndex((token) => token.id === id);
      if (index < 0) return null;
      const normalizedPatch = preserveNewerSession(current[index], patch);
      current[index] = normalizeToken({
        ...current[index],
        ...normalizedPatch,
        id,
        created_at: current[index].created_at,
      });
      await writeJson(tokensFile, current);
      return current[index];
    });
  }

  async function deleteToken(id) {
    return mutate(async () => {
      const current = await listTokens();
      const next = current.filter((token) => token.id !== id);
      if (next.length === current.length) return false;
      await writeJson(tokensFile, next);
      const credentials = await readJson(tokenRefreshCredentialsFile, {});
      if (credentials && Object.hasOwn(credentials, id)) {
        delete credentials[id];
        await writeJson(tokenRefreshCredentialsFile, credentials);
      }
      return true;
    });
  }

  async function saveTokenRefreshCredential(tokenId, bin) {
    return mutate(async () => {
      const buffer = Buffer.isBuffer(bin) ? bin : Buffer.from(bin || []);
      if (buffer.length === 0) throw new Error("BIN 登录凭据为空");
      const now = new Date().toISOString();
      const credentials = await readJson(tokenRefreshCredentialsFile, {});
      const next =
        credentials && typeof credentials === "object" ? credentials : {};
      next[tokenId] = {
        ...(next[tokenId] || {}),
        bin_base64: buffer.toString("base64"),
        sha256: createHash("sha256").update(buffer).digest("hex"),
        updated_at: now,
        last_error: null,
      };
      await writeJson(tokenRefreshCredentialsFile, next);
      return {
        configured: true,
        updated_at: next[tokenId].updated_at,
      };
    });
  }

  async function getTokenRefreshCredential(tokenId) {
    const credentials = await readJson(tokenRefreshCredentialsFile, {});
    const entry = credentials?.[tokenId];
    if (!entry?.bin_base64) return null;
    return {
      bin: Buffer.from(entry.bin_base64, "base64"),
      sha256: entry.sha256 || null,
      updated_at: entry.updated_at || null,
      last_refresh_at: entry.last_refresh_at || null,
      last_attempt_at: entry.last_attempt_at || null,
      last_error: entry.last_error || null,
    };
  }

  async function listTokenRefreshCredentialStatuses() {
    const credentials = await readJson(tokenRefreshCredentialsFile, {});
    if (!credentials || typeof credentials !== "object") return {};
    return Object.fromEntries(
      Object.entries(credentials).map(([tokenId, entry]) => [
        tokenId,
        {
          configured: Boolean(entry?.bin_base64),
          sha256: entry?.sha256 || null,
          updated_at: entry?.updated_at || null,
          last_refresh_at: entry?.last_refresh_at || null,
          last_attempt_at: entry?.last_attempt_at || null,
          last_error: entry?.last_error || null,
        },
      ]),
    );
  }

  async function markTokenRefreshResult(
    tokenId,
    { success, attemptedAt, refreshedAt = null, error = null } = {},
  ) {
    return mutate(async () => {
      const credentials = await readJson(tokenRefreshCredentialsFile, {});
      if (!credentials?.[tokenId]) return null;
      const entry = credentials[tokenId];
      entry.last_attempt_at = attemptedAt || new Date().toISOString();
      entry.last_error = success ? null : String(error || "未知错误");
      if (success && refreshedAt) entry.last_refresh_at = refreshedAt;
      await writeJson(tokenRefreshCredentialsFile, credentials);
      return {
        configured: true,
        last_refresh_at: entry.last_refresh_at || null,
        last_attempt_at: entry.last_attempt_at,
        last_error: entry.last_error,
      };
    });
  }

  async function listTasks({ enabledOnly = false } = {}) {
    const values = await readJson(tasksFile, []);
    const tasks = Array.isArray(values) ? values.map(normalizeTask) : [];
    return sortByCreatedAt(
      enabledOnly ? tasks.filter((task) => task.enabled) : tasks,
    );
  }

  async function getTask(id) {
    return (await listTasks()).find((task) => task.id === id) || null;
  }

  async function createTask(input) {
    return mutate(async () => {
      const current = await listTasks();
      const task = normalizeTask(input);
      const existing = current.findIndex((entry) => entry.id === task.id);
      if (existing >= 0) current[existing] = { ...current[existing], ...task };
      else current.push(task);
      await writeJson(tasksFile, current);
      return task;
    });
  }

  async function updateTask(id, patch) {
    return mutate(async () => {
      const current = await listTasks();
      const index = current.findIndex((task) => task.id === id);
      if (index < 0) return null;
      current[index] = normalizeTask({
        ...current[index],
        ...patch,
        id,
        created_at: current[index].created_at,
      });
      await writeJson(tasksFile, current);
      return current[index];
    });
  }

  async function markTaskRun(id, at = new Date().toISOString()) {
    return updateTask(id, { last_run_at: at });
  }

  async function deleteTask(id) {
    return mutate(async () => {
      const current = await listTasks();
      const next = current.filter((task) => task.id !== id);
      if (next.length === current.length) return false;
      await writeJson(tasksFile, next);
      return true;
    });
  }

  async function appendTaskLog(input) {
    const [entry] = await appendTaskLogs([input]);
    return entry;
  }

  async function appendTaskLogs(inputs = []) {
    return mutate(async () => {
      const entries = inputs.map((input) => ({
        id: input.id || randomUUID(),
        run_id: input.run_id || null,
        task_id: input.task_id || null,
        token_id: input.token_id || input.account_id || null,
        token_name: input.token_name || input.account_name || null,
        task_type: input.task_type || null,
        status: input.status || input.level || "info",
        level: input.level || input.status || "info",
        message: input.message || null,
        source: input.source || "server",
        created_at: input.created_at || new Date().toISOString(),
      }));
      if (entries.length > 0) {
        await fs.appendFile(
          logsFile,
          `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
          { mode: 0o600 },
        );
      }
      return entries;
    });
  }

  async function listTaskLogs(
    limit = 100,
    { status = null, taskId = null, runId = null } = {},
  ) {
    try {
      const content = await fs.readFile(logsFile, "utf8");
      const parsed = [];
      for (const line of content.split("\n")) {
        if (!line) continue;
        try {
          parsed.push(JSON.parse(line));
        } catch {
          // Ignore a torn final line after an interrupted write.
        }
      }
      const filtered = parsed.filter(
        (entry) =>
          (!status || entry.status === status) &&
          (!taskId || entry.task_id === taskId) &&
          (!runId || entry.run_id === runId),
      );
      return filtered.slice(-Math.max(1, limit)).reverse();
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async function deleteTaskLogsBefore(cutoff) {
    return mutate(async () => {
      const logs = await listTaskLogs(Number.MAX_SAFE_INTEGER);
      const kept = logs.filter(
        (entry) =>
          new Date(entry.created_at || 0).getTime() >=
          new Date(cutoff).getTime(),
      );
      const ordered = kept.reverse();
      await fs.writeFile(
        logsFile,
        ordered.map((entry) => JSON.stringify(entry)).join("\n") +
          (ordered.length ? "\n" : ""),
        { mode: 0o600 },
      );
      return logs.length - kept.length;
    });
  }

  async function getBatchSettings() {
    return normalizeBatchSettings(await readJson(batchSettingsFile, {}));
  }

  async function hasBatchSettings() {
    try {
      await fs.access(batchSettingsFile);
      return true;
    } catch {
      return false;
    }
  }

  async function updateBatchSettings(patch = {}) {
    return mutate(async () => {
      const current = await getBatchSettings();
      const next = normalizeBatchSettings({
        ...current,
        ...(patch && typeof patch === "object" ? patch : {}),
      });
      await writeJson(batchSettingsFile, next);
      return next;
    });
  }

  async function listNightmareRunStates() {
    const values = await readJson(nightmareRunsFile, {});
    return values && typeof values === "object" ? values : {};
  }

  async function getNightmareRunState(id) {
    const values = await listNightmareRunStates();
    return values[String(id)] || null;
  }

  async function saveNightmareRunState(state = {}) {
    return mutate(async () => {
      const id = String(state.taskId || state.teamId || state.id || "");
      if (!id) throw new Error("十殿运行状态缺少 taskId/teamId");
      const current = await listNightmareRunStates();
      current[id] = {
        ...state,
        id,
        updatedAt: state.updatedAt || new Date().toISOString(),
      };
      await writeJson(nightmareRunsFile, current);
      return current[id];
    });
  }

  async function deleteNightmareRunState(id) {
    return mutate(async () => {
      const current = await listNightmareRunStates();
      if (!Object.hasOwn(current, String(id))) return false;
      delete current[String(id)];
      await writeJson(nightmareRunsFile, current);
      return true;
    });
  }

  return {
    kind: "local",
    root,
    init: () => fs.mkdir(root, { recursive: true }),
    listTokens,
    getToken,
    createToken,
    updateToken,
    deleteToken,
    saveTokenRefreshCredential,
    getTokenRefreshCredential,
    listTokenRefreshCredentialStatuses,
    markTokenRefreshResult,
    listTasks,
    getTask,
    createTask,
    updateTask,
    markTaskRun,
    deleteTask,
    getBatchSettings,
    hasBatchSettings,
    updateBatchSettings,
    listNightmareRunStates,
    getNightmareRunState,
    saveNightmareRunState,
    deleteNightmareRunState,
    appendTaskLog,
    appendTaskLogs,
    listTaskLogs,
    deleteTaskLogsBefore,
  };
}
