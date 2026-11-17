import assert from "node:assert/strict";
import test from "node:test";
import {
  createFailedTaskRetryScheduler,
  shouldRetryTaskAutomatically,
} from "../render-backend/lib/taskRetry.js";

test("only automatic residual, hang-up and bottle tasks are retryable", () => {
  for (const key of [
    "batchLegacyClaim",
    "claimHangUpRewards",
    "resetBottles",
  ]) {
    assert.equal(
      shouldRetryTaskAutomatically(
        { selected_tasks: [key] },
        "nas-cron",
      ),
      true,
    );
  }
  assert.equal(
    shouldRetryTaskAutomatically(
      { selected_tasks: ["batchLegacyClaim"] },
      "nas-manual",
    ),
    false,
  );
  assert.equal(
    shouldRetryTaskAutomatically(
      { selected_tasks: ["startBatch"] },
      "nas-cron",
    ),
    false,
  );
});

test("failed task retry runs once for only the failed selected accounts", async () => {
  const now = 1_800_000_000_000;
  const timers = [];
  const executions = [];
  const logs = [];
  const task = {
    id: "task-a",
    name: "收残券",
    enabled: true,
    selected_tasks: ["batchLegacyClaim"],
    selected_tokens: ["failed-token", "successful-token"],
  };
  const scheduler = createFailedTaskRetryScheduler({
    dataStore: {
      getTask: async () => task,
    },
    executeTask: async (nextTask, options) => {
      executions.push({ task: nextTask, options });
      return true;
    },
    addLog: (...entry) => logs.push(entry),
    delayMs: 30 * 60 * 1000,
    now: () => now,
    setTimer: (callback) => {
      const timer = { callback, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => {},
  });

  const scheduled = scheduler.schedule({
    task,
    tokenIds: ["failed-token"],
    source: "nas-cron",
  });
  assert.equal(scheduled.tokenIds.length, 1);
  assert.equal(scheduled.delayMs, 30 * 60 * 1000);
  assert.equal(timers.length, 1);

  await timers[0].callback();
  assert.equal(executions.length, 1);
  assert.deepEqual(executions[0].task.selected_tokens, ["failed-token"]);
  assert.deepEqual(executions[0].options, {
    source: "nas-retry",
    retryAttempt: 1,
  });
  assert.equal(
    logs.some((entry) => entry[2].includes("开始重试 1 个失败账号")),
    true,
  );
});
