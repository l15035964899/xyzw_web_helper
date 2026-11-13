import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
  "utf8",
);

test("batch daily schedules are managed and triggered through NAS APIs", () => {
  for (const marker of [
    "loadServerSchedules",
    "saveServerSchedule",
    "deleteServerSchedule",
    "runServerSchedule",
    "previewServerCron",
    "loadServerTaskRuntime",
  ]) {
    assert.match(source, new RegExp(marker));
  }
});

test("browser lifecycle scheduler is removed", () => {
  assert.doesNotMatch(source, /const startScheduler\s*=/);
  assert.doesNotMatch(source, /lastTaskExecution_\$\{task\.id\}/);
  assert.doesNotMatch(source, /scheduleTaskExecution\(\)/);
});
