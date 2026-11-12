import assert from "node:assert/strict";
import test from "node:test";
import {
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
