import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBatchSettingsToTask,
  normalizeBatchSettings,
} from "../render-backend/lib/batchSettings.js";

test("batch settings normalize execution values and preserve secrets", () => {
  const settings = normalizeBatchSettings({
    boxCount: 25,
    defaultBoxType: 9999,
    dreamPurchaseList: ["1-5", "1-5", "bad"],
    blackMarketPurchaseList: [{ itemId: 2002, discount: 50 }],
    receiverId: " 123 ",
    password: "secret",
  });
  assert.equal(settings.boxCount, 25);
  assert.equal(settings.defaultBoxType, 2005);
  assert.deepEqual(settings.dreamPurchaseList, ["1-5"]);
  assert.deepEqual(settings.blackMarketPurchaseList, [
    { itemId: 2002, discount: 10 },
  ]);
  assert.equal(settings.receiverId, "123");
  assert.equal(settings.password, "secret");
});

test("diamond boxes are accepted as a batch box type", () => {
  assert.equal(
    normalizeBatchSettings({ defaultBoxType: 2005 }).defaultBoxType,
    2005,
  );
});

test("task-specific options override NAS global settings", () => {
  const task = applyBatchSettingsToTask(
    {
      id: "task-a",
      options: { boxCount: 5, legionId: 88 },
    },
    { boxCount: 100, defaultBoxType: 2003 },
  );
  assert.equal(task.options.boxCount, 5);
  assert.equal(task.options.boxType, 2003);
  assert.equal(task.options.legionId, 88);
});

test("an explicitly empty dream list remains disabled", () => {
  const settings = normalizeBatchSettings({
    dreamPurchaseList: [],
    blackMarketPurchaseList: [],
  });
  assert.deepEqual(settings.dreamPurchaseList, []);
  assert.deepEqual(settings.blackMarketPurchaseList, []);
});
