import assert from "node:assert/strict";
import test from "node:test";
import {
  __test,
  runArenaFights,
  runResetBottles,
  runXuanwuBlessing,
} from "../render-backend/lib/gameTasks.js";

test("salt bottle reset stops before restarting the timer", async () => {
  const calls = [];
  const client = {
    async sendWithPromise(cmd) {
      calls.push(cmd);
      return {};
    },
  };

  const results = await runResetBottles(client, { delayMs: 0 });

  assert.deepEqual(calls, ["bottlehelper_stop", "bottlehelper_start"]);
  assert.deepEqual(
    results.map(({ cmd, success }) => ({ cmd, success })),
    [
      { cmd: "bottlehelper_stop", success: true },
      { cmd: "bottlehelper_start", success: true },
    ],
  );
});

test("Shanghai activity-date prefixes do not depend on the Render host timezone", () => {
  assert.equal(
    __test.shanghaiDateBase(new Date("2026-11-10T16:30:00.000Z")),
    "261111",
  );
});

test("Xuanwu blessing claims tasks, pass rewards, goods, lottery and sign-in", async () => {
  const now = new Date("2026-11-11T04:00:00.000Z");
  const actId = 2611111;
  let warOrderReads = 0;
  const calls = [];
  const client = {
    async sendWithPromise(cmd, params = {}) {
      calls.push({ cmd, params });
      if (cmd === "activity_warorderget") {
        warOrderReads += 1;
        return {
          activity: {
            warOrderActivityInfo: {
              [actId]: {
                complete: warOrderReads === 1 ? { 1: 1, 2: 1 } : { 1: 1, 3: 1 },
                taskClaimed: warOrderReads === 1 ? { 2: true } : { 1: true },
              },
            },
          },
        };
      }
      if (cmd === "activity_warordertaskclaim") {
        if (params.missionId === 1 || params.missionId === 3) {
          return { reward: [{ type: 2, value: 50 }] };
        }
        return {};
      }
      if (cmd === "activity_warorderrewardclaim") {
        const attempts = calls.filter(
          (call) => call.cmd === "activity_warorderrewardclaim",
        ).length;
        return attempts === 1 || attempts === 3
          ? { reward: [{ type: 3, itemId: 10, value: 1 }] }
          : {};
      }
      if (cmd === "activity_commonbuygoods") {
        return { reward: [{ type: 3, itemId: 11, value: 1 }] };
      }
      if (cmd === "activity_lottery") {
        return { reward: [{ type: 3, itemId: 12, value: 1 }] };
      }
      if (cmd === "activity_claimsignreward") {
        return params.patchDay === 0
          ? { reward: [{ type: 2, value: 10 }] }
          : {};
      }
      return {};
    },
  };

  const results = await runXuanwuBlessing(client, {
    delayMs: 0,
    now,
  });
  const commandNames = calls.map(({ cmd }) => cmd);

  assert.equal(
    calls.find(
      (call) =>
        call.cmd === "activity_warordertaskclaim" &&
        call.params.missionId === 2,
    ),
    undefined,
  );
  assert.ok(commandNames.includes("activity_commonbuygoods"));
  assert.ok(commandNames.includes("activity_lottery"));
  assert.equal(
    calls.filter((call) => call.cmd === "activity_claimsignreward").length,
    7,
  );
  const summary = results.at(-1);
  assert.equal(summary.cmd, "batchXuanwuBlessing");
  assert.match(summary.message, /任务领取2个/);
  assert.match(summary.message, /通行证奖励2次/);
  assert.match(summary.message, /点卯1天/);
});

test("Xuanwu blessing fails before writes when the activity cannot be found", async () => {
  const calls = [];
  const client = {
    async sendWithPromise(cmd, params) {
      calls.push({ cmd, params });
      return {};
    },
  };

  await assert.rejects(
    runXuanwuBlessing(client, {
      delayMs: 0,
      now: new Date("2026-11-11T04:00:00.000Z"),
    }),
    /未找到玄武赐福活动/,
  );
  assert.equal(calls.length, 7);
  assert.ok(
    calls.every(({ cmd }) => cmd === "activity_warorderget"),
    "no write command should run before the activity is resolved",
  );
});

test("arena task fights with available tickets and restores the original formation", async () => {
  const calls = [];
  const client = {
    async sendWithPromise(cmd, params = {}) {
      calls.push({ cmd, params });
      if (cmd === "role_getroleinfo") {
        return { role: { items: { 1007: { quantity: 2 } } } };
      }
      if (cmd === "presetteam_getinfo") {
        return { presetTeamInfo: { useTeamId: 2 } };
      }
      if (cmd === "arena_getareatarget") {
        return { targets: [{ roleId: 9001 }] };
      }
      return {};
    },
  };

  const results = await runArenaFights(client, {
    token: { id: "account-a", name: "Test account" },
    delayMs: 0,
  });

  assert.equal(
    calls.filter(({ cmd }) => cmd === "fight_startareaarena").length,
    2,
  );
  assert.deepEqual(
    calls
      .filter(({ cmd }) => cmd === "presetteam_saveteam")
      .map(({ params }) => params.teamId),
    [1, 2],
  );
  assert.equal(
    results.filter(({ cmd, success }) => cmd === "arenaFight" && success)
      .length,
    2,
  );
});

test("arena task skips without using formation or battle commands when tickets are zero", async () => {
  const calls = [];
  const client = {
    async sendWithPromise(cmd) {
      calls.push(cmd);
      return { role: { items: { 1007: { quantity: 0 } } } };
    },
  };

  const results = await runArenaFights(client, {
    token: { id: "account-a", name: "Test account" },
    delayMs: 0,
  });

  assert.deepEqual(calls, ["role_getroleinfo"]);
  assert.match(results.at(-1).message, /跳过竞技场战斗/);
});
