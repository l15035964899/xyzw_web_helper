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

test("task-specific charm layers and arena ticket count round-trip independently", () => {
  const ui = module.serverTaskToUi({
    id: "task-b",
    name: "抢符和清票",
    cron_expr: "0 12 * * *",
    selected_tasks: ["nightmareCharmPurchase", "batchArenaClearTickets"],
    selected_tokens: ["account-a"],
    options: {
      charmLayers: [2, 6],
      charmTargets: { 2: 2, 6: 3 },
      arenaTicketCount: 75,
    },
  });

  assert.deepEqual(ui.charmLayers, [2, 6]);
  assert.equal(
    JSON.stringify(ui.charmTargets),
    JSON.stringify({
      1: 1,
      2: 2,
      3: 1,
      4: 1,
      5: 1,
      6: 3,
    }),
  );
  assert.equal(ui.arenaTicketCount, 75);

  const body = module.uiTaskToServer({
    ...ui,
    charmLayers: [5],
    charmTargets: { 5: null },
    arenaTicketCount: 500,
  });
  assert.equal(JSON.stringify(body.options.charmLayers), JSON.stringify([5]));
  assert.equal(
    JSON.stringify(body.options.charmTargets),
    JSON.stringify({ 5: 1 }),
  );
  assert.equal(body.options.arenaTicketCount, 100);
});

test("nightmare scheduled task is fixed to the Sunday 23:50 sequence", () => {
  const body = module.uiTaskToServer({
    name: "自动十殿",
    runType: "daily",
    runTime: "08:00",
    selectedTasks: ["nightmareChallenge"],
    selectedTokens: ["account-a"],
    enabled: true,
  });

  assert.equal(body.schedule_type, "cron");
  assert.equal(body.cron_expr, "50 23 * * 0");
  assert.equal(body.run_time, null);
  assert.equal(body.options.nightmareSequence, true);
  assert.equal(body.options.nightmareTeamId, undefined);
  assert.equal(body.options.nightmareSingleTeam, undefined);
});
