import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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
  const logsFile = path.join(root, "task-logs.jsonl");
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
      if (existing >= 0) current[existing] = { ...current[existing], ...token };
      else current.push(token);
      await writeJson(tokensFile, current);
      return token;
    });
  }

  async function updateToken(id, patch) {
    return mutate(async () => {
      const current = await listTokens();
      const index = current.findIndex((token) => token.id === id);
      if (index < 0) return null;
      current[index] = normalizeToken({
        ...current[index],
        ...patch,
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
      return true;
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
    return mutate(async () => {
      const entry = {
        id: randomUUID(),
        task_id: input.task_id || null,
        token_name: input.token_name || null,
        task_type: input.task_type || null,
        status: input.status || "info",
        message: input.message || null,
        created_at: input.created_at || new Date().toISOString(),
      };
      await fs.appendFile(logsFile, `${JSON.stringify(entry)}\n`, {
        mode: 0o600,
      });
      return entry;
    });
  }

  async function listTaskLogs(limit = 100) {
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
      return parsed.slice(-Math.max(1, limit)).reverse();
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

  return {
    kind: "local",
    root,
    init: () => fs.mkdir(root, { recursive: true }),
    listTokens,
    getToken,
    createToken,
    updateToken,
    deleteToken,
    listTasks,
    getTask,
    createTask,
    updateTask,
    markTaskRun,
    deleteTask,
    appendTaskLog,
    listTaskLogs,
    deleteTaskLogsBefore,
  };
}
