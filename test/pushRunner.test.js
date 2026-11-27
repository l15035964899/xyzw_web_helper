import assert from "node:assert/strict";
import test from "node:test";
import { PushRunner } from "../render-backend/lib/pushRunner.js";
import {
  createPushAccountState,
  normalizePushOptions,
} from "../render-backend/lib/pushState.js";

function createClient({
  initialLevel = 100,
  fight = null,
  roleAfterUnknown = null,
} = {}) {
  let roleReads = 0;
  const calls = [];
  const client = {
    connected: true,
    battleVersion: 240999,
    async connect() {
      calls.push("connect");
    },
    disconnect() {
      this.connected = false;
      calls.push("disconnect");
    },
    async ensureBattleVersion() {
      calls.push("ensureBattleVersion");
      return 240999;
    },
    async sendWithPromise(cmd, params) {
      calls.push({ cmd, params });
      if (cmd === "role_getroleinfo") {
        roleReads += 1;
        const level =
          roleReads > 1 && roleAfterUnknown != null
            ? roleAfterUnknown
            : initialLevel;
        return { role: { roleId: 101, levelId: level, items: [] } };
      }
      if (cmd === "fight_calcleveltime") {
        return { battleTime: 1 };
      }
      if (cmd === "fight_level") {
        if (fight) return fight({ calls, params });
        return { success: true, currLevel: initialLevel + 1 };
      }
      return {};
    },
  };
  return { client, calls };
}

function createRunner(client, overrides = {}) {
  let currentTime = 0;
  const state = createPushAccountState({
    tokenId: "a",
    tokenName: "账号-A",
    level: 100,
  });
  const runner = new PushRunner({
    token: { id: "a", name: "账号-A" },
    options: normalizePushOptions({
      autoUpgradeHangup: false,
      battleIntervalSeconds: 1,
    }),
    state,
    createClient: () => client,
    now: () => currentTime,
    sleep: async (ms) => {
      currentTime += ms;
    },
    maxBattles: 1,
    ...overrides,
  });
  return { runner, state };
}

test("push runner advances one level after a confirmed victory", async () => {
  const { client, calls } = createClient();
  const { runner, state } = createRunner(client);
  const result = await runner.run();

  assert.equal(result.reason, "batch-complete");
  assert.equal(state.level, 101);
  assert.equal(state.wins, 1);
  assert.equal(state.losses, 0);
  assert.equal(calls.filter((entry) => entry?.cmd === "fight_level").length, 1);
});

test("fight_level timeout reconciles the live level without replaying settlement", async () => {
  const { client, calls } = createClient({
    roleAfterUnknown: 101,
    fight: async () => {
      throw new Error("请求超时: fight_level (15000ms)");
    },
  });
  const { runner, state } = createRunner(client);
  const result = await runner.run();

  assert.equal(result.reason, "batch-complete");
  assert.equal(state.level, 101);
  assert.equal(state.wins, 1);
  assert.equal(calls.filter((entry) => entry?.cmd === "fight_level").length, 1);
});

test("battle version expiry refreshes the version and never blindly replays fight_level", async () => {
  const { client, calls } = createClient({
    roleAfterUnknown: 101,
    fight: async () => {
      const error = new Error("战斗版本已失效");
      error.code = 200750;
      throw error;
    },
  });
  const { runner, state } = createRunner(client);
  const result = await runner.run();

  assert.equal(result.reason, "batch-complete");
  assert.equal(state.level, 101);
  assert.equal(
    calls.filter((entry) => entry === "ensureBattleVersion").length,
    2,
  );
  assert.equal(calls.filter((entry) => entry?.cmd === "fight_level").length, 1);
});

test("force stop interrupts the battle wait before settlement", async () => {
  const { client, calls } = createClient();
  const controller = new AbortController();
  let waitCalls = 0;
  const { runner } = createRunner(client, {
    signal: controller.signal,
    sleep: async () => {
      waitCalls += 1;
      if (waitCalls === 1) controller.abort();
    },
  });

  await assert.rejects(runner.run(), /强制停止/);
  assert.equal(calls.filter((entry) => entry?.cmd === "fight_level").length, 0);
});
