import assert from "node:assert/strict";
import test from "node:test";
import { sortScheduledTasks } from "../src/utils/sortScheduledTasks.js";

test("scheduled task modal sorts by next run and keeps disabled tasks last", () => {
  const tasks = [
    { id: "disabled", name: "禁用", enabled: false },
    { id: "later", name: "稍后", enabled: true },
    { id: "unknown", name: "无计划", enabled: true },
    { id: "first", name: "最近", enabled: true },
  ];
  const nextRuns = {
    later: 2_000,
    first: 1_000,
  };
  const sorted = sortScheduledTasks(tasks, (task) => nextRuns[task.id]);
  assert.deepEqual(
    sorted.map((task) => task.id),
    ["first", "later", "unknown", "disabled"],
  );
});
