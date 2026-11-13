import { requestBatchServer } from "@/api/batchSchedules";

const FLUSH_INTERVAL_MS = 2000;
const MAX_BATCH = 100;
const MAX_PENDING = 500;

let pending = [];
let flushTimer = null;
let flushing = null;
let context = {};
const browserLogSessionId = `browser_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

function normalizeLevel(type) {
  if (type === "warning" || type === "warn") return "warning";
  if (type === "error" || type === "success") return type;
  return "info";
}

export function setBrowserLogContext(next = {}) {
  context = {
    run_id: next.runId || next.run_id || null,
    task_id: next.taskId || next.task_id || null,
    token_id: next.tokenId || next.token_id || null,
    token_name: next.tokenName || next.token_name || null,
    task_type: next.taskType || next.task_type || null,
    source: next.source || "browser-manual",
  };
}

export function clearBrowserLogContext() {
  context = {};
}

export function queueBrowserLog(log = {}) {
  pending.push({
    ...context,
    run_id: context.run_id || browserLogSessionId,
    source: context.source || "browser-manual",
    level: normalizeLevel(log.type),
    message: String(log.message || ""),
    created_at: log.created_at || new Date().toISOString(),
  });
  if (pending.length > MAX_PENDING) {
    pending = pending.slice(-MAX_PENDING);
  }
}

async function sendBatch(entries) {
  await requestBatchServer("/api/logs/db/batch", {
    method: "POST",
    body: { logs: entries },
  });
}

export async function flushBrowserLogs() {
  if (flushing) return flushing;
  if (pending.length === 0) return;

  const entries = pending.splice(0, MAX_BATCH);
  flushing = sendBatch(entries)
    .catch((error) => {
      pending = [...entries, ...pending].slice(-MAX_PENDING);
      throw error;
    })
    .finally(() => {
      flushing = null;
    });
  return flushing;
}

function periodicFlush() {
  flushBrowserLogs().catch((error) => {
    console.warn("保存浏览器日志失败:", error.message);
  });
}

export function startBrowserLogPersistence() {
  if (flushTimer) return;
  flushTimer = setInterval(periodicFlush, FLUSH_INTERVAL_MS);
  window.addEventListener("pagehide", handlePageHide);
}

export async function stopBrowserLogPersistence() {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  window.removeEventListener("pagehide", handlePageHide);
  while (pending.length > 0 || flushing) {
    try {
      await flushBrowserLogs();
    } catch {
      break;
    }
  }
}

function handlePageHide() {
  if (pending.length === 0) return;
  const entries = pending.splice(0, MAX_BATCH);
  const body = JSON.stringify({ logs: entries });
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon("/api/logs/db/batch", blob)) {
      pending = [...entries, ...pending].slice(-MAX_PENDING);
    }
  }
}
