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

test("manual nightmare team operations are persisted with a run id", () => {
  assert.match(server, /writeManualNightmareLog/);
  assert.match(server, /开始手动创建\/准备十殿队伍[\s\S]*开始手动解散十殿队伍/);
  assert.match(server, /source:\s*"nas-manual"/);
});

test("token refresh runs only after the task has acquired its account locks", () => {
  const scheduledLock = server.search(
    /(?:let|const) taskLease = await tokenLockQueue\.acquireAll/,
  );
  const scheduledRefresh = server.indexOf(
    "const refreshSummary = await tokenRefreshManager.run",
  );
  const prepareStart = server.indexOf(
    "async function prepareNightmareTeamManually",
  );
  const disbandStart = server.indexOf(
    "async function disbandNightmareTeamManually",
  );
  const prepareLease = server.indexOf("manual-prepare:", prepareStart);
  const prepareRefresh = server.indexOf(
    "await tokenRefreshManager.run",
    prepareStart,
  );
  const disbandLease = server.indexOf("manual-disband:", disbandStart);
  const disbandRefresh = server.indexOf(
    "await tokenRefreshManager.run",
    disbandStart,
  );

  assert.ok(scheduledLock >= 0 && scheduledLock < scheduledRefresh);
  assert.ok(prepareLease >= 0 && prepareLease < prepareRefresh);
  assert.ok(disbandLease >= 0 && disbandLease < disbandRefresh);
});
