import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.js";

const module = await loadModule(
  new URL("../src/api/batchSchedules.js", import.meta.url),
  {
    "@/api/serverTasks": {
      loadServerConnection: () => ({}),
      serverRequest: async () => null,
    },
  },
);

test("server daily schedule round-trips into the batch daily UI shape", () => {
  const ui = module.serverTaskToUi({
    id: "task-a",
    name: "日常",
    cron_expr: "10 6 * * *",
    selected_tasks: ["startBatch"],
    selected_tokens: ["account-a"],
    enabled: true,
    next_run_at: "2026-11-13T22:10:00.000Z",
  });
  assert.equal(ui.runType, "daily");
  assert.equal(ui.runTime, "06:10");
  assert.equal(ui.nextRunAt, "2026-11-13T22:10:00.000Z");

  const body = module.uiTaskToServer(
    { ...ui, legionApplyTargetId: 42 },
    { existingOptions: { dreamPurchaseList: ["1-5"] } },
  );
  assert.equal(body.cron_expr, "10 6 * * *");
  assert.equal(body.schedule_type, "daily");
  assert.equal(body.options.legionId, 42);
  assert.deepEqual(body.options.dreamPurchaseList, ["1-5"]);
});

test("daily time conversion rejects out-of-range values", () => {
  assert.equal(module.dailyTimeToCron("06:10"), "10 6 * * *");
  assert.throws(() => module.dailyTimeToCron("24:00"), /范围/);
});
