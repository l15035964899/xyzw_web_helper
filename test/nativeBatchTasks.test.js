import assert from "node:assert/strict";
import test from "node:test";
import {
  claimLegacyHangUp,
  createNativeTaskDefinitions,
  NATIVE_TASK_CATALOG,
  runNativeBatchTask,
} from "../render-backend/lib/nativeBatchTasks.js";
import { availableTasks } from "../src/utils/batch/constants.js";

function token() {
  return { id: "account-a", name: "测试账号" };
}

test("server task picker contains every native scheduled batch task", () => {
  assert.deepEqual(
    new Set(Object.keys(NATIVE_TASK_CATALOG)),
    new Set(availableTasks.map(({ value }) => value)),
  );
  const definitions = createNativeTaskDefinitions();
  assert.equal(Object.keys(definitions).length, availableTasks.length);
  assert.ok(
    Object.values(definitions).every(
      (definition) =>
        definition.name &&
        definition.group &&
        typeof definition.run === "function",
    ),
  );
  const dreamOption = NATIVE_TASK_CATALOG.batchBuyDreamItems.options[0];
  assert.equal(dreamOption.type, "dream-items");
  assert.ok(Array.isArray(dreamOption.default));
});

test("batch box task applies configured type and count", async () => {
  const calls = [];
  const client = {
    async sendWithPromise(cmd, params = {}) {
      calls.push({ cmd, params });
      return {};
    },
  };
  const results = await runNativeBatchTask("batchOpenBox", client, {
    token: token(),
    task: {
      id: "task-a",
      options: { boxType: 2003, boxCount: 25 },
    },
  });
  assert.deepEqual(
    calls
      .filter(({ cmd }) => cmd === "item_openbox")
      .map(({ params }) => [params.itemId, params.number]),
    [
      [2003, 10],
      [2003, 10],
      [2003, 5],
    ],
  );
  assert.ok(calls.some(({ cmd }) => cmd === "item_batchclaimboxpointreward"));
  assert.match(results[0].message, /25/);
});

test("black market sync writes only a verified changed configuration", async () => {
  const calls = [];
  let items = [
    { itemId: 2002, discount: 10 },
    { itemId: 2003, discount: 10 },
  ];
  const client = {
    async sendWithPromise(cmd, params = {}) {
      calls.push({ cmd, params });
      if (cmd === "store_getpurchase") {
        return { purchaseCnt: 2, purchaseItemList: items };
      }
      if (cmd === "store_setpurchase") {
        items = params.purchaseItemList;
        return {};
      }
      return {};
    },
  };
  const results = await runNativeBatchTask("store_syncpurchaseconfig", client, {
    token: token(),
    task: {
      options: { blackMarketPurchaseList: "2002:10,2003:10" },
    },
  });
  assert.equal(
    calls.filter(({ cmd }) => cmd === "store_setpurchase").length,
    0,
  );
  assert.match(results[0].message, /已同步 2 项/);
});

test("redeem-code task sends every configured code once", async () => {
  const calls = [];
  const client = {
    async sendWithPromise(cmd, params = {}) {
      calls.push({ cmd, params });
      return {};
    },
  };
  const results = await runNativeBatchTask("batchRedeemCodes", client, {
    token: token(),
    task: {
      options: { redeemCodes: "CODE1\nCODE2, CODE1", platformType: "wx" },
    },
  });
  assert.deepEqual(
    calls.map(({ params }) => params.key),
    ["CODE1", "CODE2"],
  );
  assert.ok(calls.every(({ params }) => params.platformType === "wx"));
  assert.match(results[0].message, /成功 2/);
});

test("already-completed club sign-in is treated as a successful skip", async () => {
  const client = {
    async sendWithPromise(cmd) {
      assert.equal(cmd, "legion_signin");
      throw new Error("[2300190] 今天已经签到");
    },
  };
  const results = await runNativeBatchTask("batchclubsign", client, {
    token: token(),
    task: { options: {} },
  });
  assert.equal(results[0].success, true);
  assert.match(results[0].message, /已经签到/);
});

test("ten-day gift task uses the captured free-pack command", async () => {
  const calls = [];
  const client = {
    async sendWithPromise(cmd, params = {}) {
      calls.push({ cmd, params });
      return {};
    },
  };

  const results = await runNativeBatchTask(
    "activity_claimrolluppack",
    client,
    {
      token: token(),
      task: { options: {} },
    },
  );

  assert.deepEqual(calls, [
    { cmd: "activity_claimrolluppack", params: { id: 17 } },
  ]);
  assert.equal(results[0].success, true);
  assert.match(results[0].message, /十殿免费礼包领取完成/);
});

test("ten-day gift task treats an already-claimed pack as a successful skip", async () => {
  const client = {
    async sendWithPromise(cmd) {
      assert.equal(cmd, "activity_claimrolluppack");
      throw new Error("[12000116] 今日已领取免费奖励");
    },
  };

  const results = await runNativeBatchTask(
    "activity_claimrolluppack",
    client,
    {
      token: token(),
      task: { options: {} },
    },
  );

  assert.equal(results[0].success, true);
  assert.equal(results[0].status, "info");
  assert.match(results[0].message, /今日已经领取/);
});

test("ten-day gift task treats 200020 as a non-failing warning", async () => {
  const client = {
    async sendWithPromise(cmd) {
      assert.equal(cmd, "activity_claimrolluppack");
      throw new Error(
        "[200020] 出了点小问题，请尝试重启游戏解决～",
      );
    },
  };

  const results = await runNativeBatchTask(
    "activity_claimrolluppack",
    client,
    {
      token: token(),
      task: { options: {} },
    },
  );

  assert.equal(results[0].success, true);
  assert.equal(results[0].status, "warning");
  assert.match(results[0].message, /200020/);
  assert.match(results[0].message, /可能已经领取/);
});

test("recruit-week store task uses the captured free-goods parameters", async () => {
  const calls = [];
  const client = {
    async sendWithPromise(cmd, params = {}) {
      calls.push({ cmd, params });
      if (cmd === "activity_get") {
        return {
          activity: {
            activity: [{ id: 6, type: 4 }],
            myStoreInfo: { 6: { complete: { 0: 0 } } },
          },
        };
      }
      return {};
    },
  };

  const results = await runNativeBatchTask("activity_buystoregoods", client, {
    token: token(),
    task: { options: {} },
  });

  assert.deepEqual(calls, [
    { cmd: "activity_get", params: {} },
    {
      cmd: "activity_buystoregoods",
      params: { activityId: 6, goodsIndex: 0, buyNum: 1 },
    },
  ]);
  assert.equal(results[0].success, true);
  assert.match(results[0].message, /招募周限时商店奖励领取完成/);
});

test("recruit-week store task treats an already-claimed goods as a successful skip", async () => {
  const calls = [];
  const client = {
    async sendWithPromise(cmd, params = {}) {
      calls.push({ cmd, params });
      if (cmd === "activity_get") {
        return {
          activity: {
            activity: [{ id: 6, type: 4 }],
            myStoreInfo: { 6: { complete: { 0: 1 } } },
          },
        };
      }
      throw new Error("activity_buystoregoods should not be sent");
    },
  };

  const results = await runNativeBatchTask("activity_buystoregoods", client, {
    token: token(),
    task: { options: {} },
  });

  assert.equal(results[0].success, true);
  assert.equal(results[0].status, "info");
  assert.match(results[0].message, /本周已经领取/);
  assert.deepEqual(calls, [{ cmd: "activity_get", params: {} }]);
});

test("recruit-week store task skips other rotating weekly activity types", async () => {
  const calls = [];
  const client = {
    async sendWithPromise(cmd, params = {}) {
      calls.push({ cmd, params });
      if (cmd === "activity_get") {
        return {
          activity: {
            activity: [{ id: 6, type: 5 }],
            myStoreInfo: { 6: { complete: { 0: 0 } } },
          },
        };
      }
      throw new Error("activity_buystoregoods should not be sent");
    },
  };

  const results = await runNativeBatchTask("activity_buystoregoods", client, {
    token: token(),
    task: { options: {} },
  });

  assert.equal(results[0].success, true);
  assert.equal(results[0].status, "info");
  assert.match(results[0].message, /当前不是招募周/);
  assert.deepEqual(calls, [{ cmd: "activity_get", params: {} }]);
});

test("recruit-week store 1100010 is a non-failing warning", async () => {
  const client = {
    async sendWithPromise(cmd) {
      if (cmd === "activity_get") {
        return {
          activity: {
            activity: [{ id: 6, type: 4 }],
            myStoreInfo: { 6: { complete: { 0: 0 } } },
          },
        };
      }
      assert.equal(cmd, "activity_buystoregoods");
      throw new Error("[1100010] 本周限购奖励已领取");
    },
  };

  const results = await runNativeBatchTask("activity_buystoregoods", client, {
    token: token(),
    task: { options: {} },
  });

  assert.equal(results[0].success, true);
  assert.equal(results[0].status, "warning");
  assert.match(results[0].message, /本周已经领取/);
});

test("legacy claim starts collection and defers until the first reward matures", async () => {
  const serverTime = 1_800_000_000_000;
  const calls = [];
  const client = {
    get serverTime() {
      return serverTime;
    },
    async sendWithPromise(cmd, params = {}) {
      calls.push({ cmd, params });
      if (cmd === "legacy_getinfo") {
        return { roleLegacy: { hangUpBeginTime: 0 } };
      }
      if (cmd === "legacy_beginhangup") {
        return { roleLegacy: { hangUpBeginTime: serverTime } };
      }
      return {};
    },
  };

  const result = await claimLegacyHangUp(client, {
    minCollectMs: 60_000,
    firstRewardMs: 300_000,
    settleMs: 1_500,
    deferUntilReady: true,
    now: () => serverTime,
  });

  assert.deepEqual(
    calls.map(({ cmd }) => cmd),
    ["legacy_getinfo", "legacy_beginhangup"],
  );
  assert.equal(result.startedNow, true);
  assert.equal(result.deferred, true);
  assert.equal(result.waitMs, 301_500);
});

test("legacy claim skips the wait when collection is already mature", async () => {
  const serverTime = 1_800_000_000_000;
  const calls = [];
  const client = {
    serverTime,
    async sendWithPromise(cmd) {
      calls.push(cmd);
      if (cmd === "legacy_getinfo") {
        return { roleLegacy: { hangUpBeginTime: serverTime - 400_000 } };
      }
      return {};
    },
  };

  const result = await claimLegacyHangUp(client, {
    firstRewardMs: 300_000,
    wait: async () => {
      throw new Error("should not wait");
    },
    now: () => serverTime,
  });

  assert.deepEqual(calls, ["legacy_getinfo", "legacy_claimhangup"]);
  assert.equal(result.startedNow, false);
  assert.equal(result.deferred, false);
  assert.equal(result.waitMs, 0);
});

test("legacy claim defers an account that was started too recently", async () => {
  const serverTime = 1_800_000_000_000;
  const client = {
    serverTime,
    async sendWithPromise(cmd) {
      if (cmd === "legacy_getinfo") {
        return {
          roleLegacy: {
            hangUpBeginTime: serverTime - 120_000,
            produceItemCnt: 0,
          },
        };
      }
      throw new Error(`unexpected command: ${cmd}`);
    },
  };

  const result = await claimLegacyHangUp(client, {
    firstRewardMs: 300_000,
    settleMs: 1_500,
    deferUntilReady: true,
    now: () => serverTime,
  });

  assert.equal(result.startedNow, false);
  assert.equal(result.deferred, true);
  assert.equal(result.waitMs, 181_500);
});

test("legacy claim treats the short-term repeat-claim guard as already handled", async () => {
  const serverTime = 1_800_000_000_000;
  const client = {
    serverTime,
    async sendWithPromise(cmd) {
      if (cmd === "legacy_getinfo") {
        return {
          roleLegacy: {
            hangUpBeginTime: serverTime - 400_000,
            produceItemCnt: 1,
          },
        };
      }
      if (cmd === "legacy_claimhangup") {
        throw new Error("[12400000] 挂机奖励领取过于频繁");
      }
      throw new Error(`unexpected command: ${cmd}`);
    },
  };

  const result = await claimLegacyHangUp(client, {
    deferUntilReady: true,
    now: () => serverTime,
  });

  assert.equal(result.rateLimited, true);
  assert.equal(result.deferred, false);
});

test("arena task uses each account's own formation setting", async () => {
  const calls = [];
  const client = {
    async sendWithPromise(cmd, params = {}) {
      calls.push({ cmd, params });
      if (cmd === "role_getroleinfo") {
        return { role: { items: { 1007: { quantity: 1 } } } };
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
  await runNativeBatchTask("batcharenafight", client, {
    token: {
      ...token(),
      daily_settings: { arenaFormation: 4 },
    },
    task: {
      options: { arenaFormation: 1 },
    },
  });
  assert.deepEqual(
    calls
      .filter(({ cmd }) => cmd === "presetteam_saveteam")
      .map(({ params }) => params.teamId),
    [4, 2],
  );
});
