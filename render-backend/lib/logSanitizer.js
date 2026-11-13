const SECRET_KEY_PATTERN =
  /("?(?:roleToken|sessId|connId|apiKey|api_key|password|securityPassword)"?\s*[:=]\s*)(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,\s}]+)/gi;

const ALLOWED_LEVELS = new Set(["info", "success", "warning", "warn", "error"]);

export function sanitizeLogMessage(value, maxLength = 8000) {
  return String(value ?? "")
    .replace(SECRET_KEY_PATTERN, "$1[REDACTED]")
    .slice(0, maxLength);
}

function shortText(value, maxLength = 200) {
  return typeof value === "string" ? value.slice(0, maxLength) : null;
}

export function normalizeClientTaskLog(input = {}) {
  const rawLevel = String(input.level || input.status || "info").toLowerCase();
  const level = ALLOWED_LEVELS.has(rawLevel) ? rawLevel : "info";
  const status = level === "warning" ? "warn" : level;
  return {
    run_id: shortText(input.run_id, 100),
    task_id: shortText(input.task_id, 100),
    token_id: shortText(input.token_id || input.account_id, 200),
    token_name: shortText(input.token_name || input.account_name, 300),
    task_type: shortText(input.task_type, 300),
    status,
    level,
    message: sanitizeLogMessage(input.message || ""),
    source: shortText(input.source, 40) || "browser-manual",
    created_at: Number.isNaN(new Date(input.created_at).getTime())
      ? new Date().toISOString()
      : new Date(input.created_at).toISOString(),
  };
}
