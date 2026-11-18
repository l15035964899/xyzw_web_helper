import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(
  new URL("../render-backend/server.js", import.meta.url),
  "utf8",
);
const taskRetry = await readFile(
  new URL("../render-backend/lib/taskRetry.js", import.meta.url),
  "utf8",
);
const page = await readFile(
  new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
  "utf8",
);

test("NAS task execution uses the browser addLog message model", () => {
  assert.match(server, /const addTaskRunLog = async/);
  assert.match(server, /result\.status === "warning"\s*\?\s*"warning"/);
  assert.match(server, /=== 开始执行: \$\{token\.name\} ===/);
  assert.match(server, /=== 定时任务执行完成: \$\{task\.name\} ===/);
  assert.doesNotMatch(server, /formatTaskLogMessage/);
  assert.match(page, /message:\s*entry\.message \|\| ""/);
});

test("pure connection retry logic is removed from NAS task execution", () => {
  assert.doesNotMatch(server, /retryPolicy/);
  assert.doesNotMatch(server, /TOKEN_RETRY_DELAYS_MS/);
  assert.doesNotMatch(server, /shouldRetryTokenAttempt/);
  assert.doesNotMatch(server, /首轮执行结束/);
});

test("failed scheduled tasks use the delayed single-retry scheduler", () => {
  assert.match(server, /createFailedTaskRetryScheduler/);
  assert.match(server, /failedTokenIds\.push\(token\.id\)/);
  assert.match(taskRetry, /source:\s*"nas-retry",\s*retryAttempt:\s*1/);
  assert.match(server, /taskRetryScheduled/);
});
