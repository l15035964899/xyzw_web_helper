import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { PushSessionManager } from "../render-backend/lib/pushSessionManager.js";
import { createPushRunState } from "../render-backend/lib/pushState.js";
import { TokenLockQueue } from "../render-backend/lib/tokenLockQueue.js";

function waitFor(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error("等待测试条件超时"));
      }
    }, 5);
  });
}

function createHarness(accountIds = ["a"], { kickFirst = false } = {}) {
  const now = Date.now();
  let clock = now;
  const tokens = accountIds.map((id) => ({
    id,
    name: `账号-${id}`,
    enabled: true,
    token: JSON.stringify({ roleToken: `secret-${id}`, connId: now }),
  }));
  const states = {};
  const clients = new Map();
  const commands = [];
  const fightCounts = new Map(accountIds.map((id) => [id, 0]));
  const fightAttempts = new Map(accountIds.map((id) => [id, 0]));
  const calcSignals = new Map(
    accountIds.map((id) => {
      let resolve;
      const promise = new Promise((done) => {
        resolve = done;
      });
      return [id, { promise, resolve }];
    }),
  );
  const dataStore = {
    async listTokens() {
      return tokens;
    },
    async getToken(id) {
      return tokens.find((token) => token.id === id) || null;
    },
    async getTokenRefreshCredential() {
      return { bin: Buffer.from([1]) };
    },
    async listPushingRunStates() {
      return states;
    },
    async savePushingRunState(state) {
      states[state.runId] = structuredClone(state);
      return state;
    },
  };
  const createClient = (token) => {
    const client = {
      connected: true,
      battleVersion: 1,
      async connect() {},
      disconnect() {
        this.connected = false;
      },
      async ensureBattleVersion() {
        return 1;
      },
      async sendWithPromise(cmd) {
        commands.push({ tokenId: token.id, cmd });
        if (cmd === "role_getroleinfo") {
          return {
            role: {
              roleId: 1000 + accountIds.indexOf(token.id),
              levelId: 200,
              items: [],
            },
          };
        }
        if (cmd === "fight_calcleveltime") {
          calcSignals.get(token.id).resolve();
          return { battleTime: 1 };
        }
        if (cmd === "fight_level") {
          fightAttempts.set(token.id, fightAttempts.get(token.id) + 1);
          if (kickFirst && fightAttempts.get(token.id) === 1) {
            const error = new Error("界面已变化，请重新登录");
            error.code = 200760;
            throw error;
          }
          fightCounts.set(token.id, fightCounts.get(token.id) + 1);
          return { success: true, currLevel: 201 };
        }
        return {};
      },
    };
    clients.set(token.id, client);
    return client;
  };
  const lockQueue = new TokenLockQueue();
  const manager = new PushSessionManager({
    dataStore,
    lockQueue,
    tokenRefreshManager: { async run() {} },
    createClient,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      await new Promise((resolve) => setImmediate(resolve));
    },
    accountBatchSize: 1,
  });
  return {
    manager,
    lockQueue,
    dataStore,
    states,
    clients,
    fightCounts,
    calcSignals,
    commands,
    advance(ms) {
      clock += ms;
    },
  };
}

test("one concurrency slot rotates across accounts instead of starving later accounts", async () => {
  const harness = createHarness(["a", "b"]);
  const run = await harness.manager.start({
    tokenIds: ["a", "b"],
    options: { maxConcurrent: 1 },
  });

  await waitFor(
    () =>
      harness.fightCounts.get("a") >= 1 && harness.fightCounts.get("b") >= 1,
  );
  await harness.manager.stop(run.runId);
  const stopped = harness.manager.get(run.runId);
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.accounts.a.status, "stopped");
  assert.equal(stopped.accounts.b.status, "stopped");
});

test("a scheduled task wait pauses the session, releases locks, and resumes afterward", async () => {
  const harness = createHarness(["a"]);
  const run = await harness.manager.start({
    tokenIds: ["a"],
    options: { maxConcurrent: 1 },
  });
  await harness.calcSignals.get("a").promise;

  let taskStarted = false;
  const taskLeasePromise = harness.lockQueue.acquire("a", "cron-task", {
    onWait: () => {},
  });
  const taskLease = taskLeasePromise.then(() => {
    taskStarted = true;
    return "cron-task";
  });
  await waitFor(() => taskStarted);
  assert.equal(harness.lockQueue.holder("a"), "cron-task");
  await waitFor(
    () => harness.manager.get(run.runId).status === "waiting-scheduled-task",
  );
  harness.lockQueue.release("a", "cron-task");
  assert.equal(await taskLease, "cron-task");

  await waitFor(() => harness.fightCounts.get("a") >= 2);
  await harness.manager.stop(run.runId);
  assert.equal(harness.manager.get(run.runId).status, "stopped");
});

test("force stop disconnects clients and releases every account lock", async () => {
  const harness = createHarness(["a"]);
  const run = await harness.manager.start({
    tokenIds: ["a"],
    options: { maxConcurrent: 1 },
  });
  await waitFor(() => harness.lockQueue.holder("a") === `pushing:${run.runId}`);
  await harness.manager.stop(run.runId);

  assert.equal(harness.lockQueue.holder("a"), null);
  assert.equal(harness.clients.get("a").connected, false);
});

test("a kicked account releases its lock and retries after the configured delay", async () => {
  const harness = createHarness(["a"], { kickFirst: true });
  const run = await harness.manager.start({
    tokenIds: ["a"],
    options: {
      maxConcurrent: 1,
      kickReloginDelayMinutes: 5,
    },
  });

  await waitFor(
    () =>
      harness.manager.get(run.runId).accounts.a.status === "waiting-relogin",
  );
  assert.equal(harness.lockQueue.holder("a"), null);
  assert.equal(harness.manager.get(run.runId).accounts.a.kickCount, 1);

  harness.advance(5 * 60 * 1000);
  await waitFor(() => harness.fightCounts.get("a") >= 1);
  await harness.manager.stop(run.runId);
});

test("container restore resumes a non-stopped run from the live role level", async () => {
  const harness = createHarness(["a"]);
  const state = createPushRunState({
    runId: "restored-run",
    tokenIds: ["a"],
    accounts: {
      a: { tokenName: "账号-a", status: "fighting", level: 999 },
    },
    options: { maxConcurrent: 1 },
  });
  state.status = "running";
  harness.states[state.runId] = structuredClone(state);

  const restored = await harness.manager.restore();
  assert.equal(restored.length, 1);
  await waitFor(() => harness.fightCounts.get("a") >= 1);
  await waitFor(
    () => harness.manager.get(state.runId).accounts.a.level === 201,
  );
  const running = harness.manager.get(state.runId);
  assert.equal(running.status, "running");
  assert.equal(running.accounts.a.level, 201);
  await harness.manager.stop(state.runId);
});

test("manual torch pauses the session, consumes the item, then resumes push", async () => {
  const harness = createHarness(["a"]);
  const run = await harness.manager.start({
    tokenIds: ["a"],
    options: { maxConcurrent: 1 },
  });
  await waitFor(() => harness.fightCounts.get("a") >= 1);

  await harness.manager.requestTorch(run.runId, {
    tokenIds: ["a"],
    itemId: 1008,
    quantity: 2,
  });
  await waitFor(() => Boolean(harness.manager.get(run.runId).lastTorchResult));
  assert.equal(
    harness.commands.some(
      (entry) => entry.tokenId === "a" && entry.cmd === "item_consume",
    ),
    true,
  );
  const torchResult = harness.manager.get(run.runId).lastTorchResult;
  assert.equal(torchResult.results[0].success, true);

  await waitFor(() => harness.manager.get(run.runId).status === "running");
  await harness.manager.stop(run.runId);
});
