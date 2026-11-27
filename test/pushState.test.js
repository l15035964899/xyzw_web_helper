import assert from "node:assert/strict";
import test from "node:test";
import {
  createPushRunState,
  isActivePushStatus,
  normalizePushOptions,
  normalizePushRunState,
} from "../render-backend/lib/pushState.js";

test("push options allow five concurrent accounts and preserve safe defaults", () => {
  const options = normalizePushOptions({
    maxConcurrent: 99,
    kickReloginDelayMinutes: 500,
  });
  assert.equal(options.maxConcurrent, 5);
  assert.equal(options.kickReloginDelayMinutes, 120);
  assert.equal(options.autoUpgradeHangup, true);
  assert.equal(options.autoContinue, true);
  assert.equal(normalizePushOptions().maxConcurrent, 5);
});

test("push state contains no credentials and survives normalization", () => {
  const state = createPushRunState({
    runId: "run-a",
    tokenIds: ["a", "b", "a"],
    accounts: {
      a: { tokenName: "账号-A", level: 123 },
    },
    options: { maxConcurrent: 2 },
  });
  state.accounts.a.roleToken = "must-not-persist";
  state.accounts.a.sessId = "must-not-persist";
  const normalized = normalizePushRunState(state);

  assert.deepEqual(normalized.tokenIds, ["a", "b"]);
  assert.equal(normalized.taskId, "pushing:run-a");
  assert.equal(normalized.accounts.a.level, 123);
  assert.equal(normalized.accounts.a.roleToken, undefined);
  assert.equal(normalized.accounts.a.sessId, undefined);
  assert.equal(isActivePushStatus(normalized.status), true);
});
