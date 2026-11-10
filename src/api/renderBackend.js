const ACCESS_KEY_STORAGE = "xyzw_remote_access_key";
const DEFAULT_TIMEOUT_MS = 65_000;

export class RemoteBackendError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = "RemoteBackendError";
    this.status = status;
    this.data = data;
  }
}

export function getRemoteAccessKey() {
  return localStorage.getItem(ACCESS_KEY_STORAGE) || "";
}

export function setRemoteAccessKey(value) {
  const key = String(value || "").trim();
  if (key) localStorage.setItem(ACCESS_KEY_STORAGE, key);
  else localStorage.removeItem(ACCESS_KEY_STORAGE);
  return key;
}

async function request(path, options = {}) {
  const {
    method = "GET",
    body,
    requiresAccess = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const accessKey = getRemoteAccessKey();
  if (requiresAccess) {
    if (!accessKey) {
      throw new RemoteBackendError("请先配置云端访问密钥", 401);
    }
    headers["X-Remote-Access-Key"] = accessKey;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`/api/remote${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const message =
        data?.error ||
        data?.message ||
        `云端请求失败 (HTTP ${response.status})`;
      throw new RemoteBackendError(message, response.status, data);
    }
    return data;
  } catch (error) {
    if (error instanceof RemoteBackendError) throw error;
    if (error?.name === "AbortError") {
      throw new RemoteBackendError(
        "云端服务响应超时；Render 免费实例可能正在冷启动，请稍后重试",
        408,
      );
    }
    throw new RemoteBackendError(error?.message || "无法连接云端服务", 0);
  } finally {
    clearTimeout(timer);
  }
}

export const renderBackendApi = {
  health: () =>
    request("/health", { requiresAccess: false, timeoutMs: 70_000 }),
  tasks: () => request("/tasks"),
  definitions: () => request("/task-definitions"),
  logs: (limit = 30) =>
    request(
      `/logs/db?limit=${Math.max(1, Math.min(Number(limit) || 30, 100))}`,
    ),
  setTaskEnabled: (taskId, enabled) =>
    request(`/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: { enabled: Boolean(enabled) },
    }),
  runTask: (taskId) =>
    request(`/tasks/${encodeURIComponent(taskId)}/run`, {
      method: "POST",
      body: {},
    }),
};
