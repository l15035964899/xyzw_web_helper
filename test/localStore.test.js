import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalStore } from "../render-backend/lib/localStore.js";

test("local store persists tokens, tasks and task logs", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xyzw-store-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const store = createLocalStore({ dataDir: directory });
  await store.init();
  assert.equal(await store.hasBatchSettings(), false);

  const token = await store.createToken({
    name: "账号一",
    token: JSON.stringify({ roleToken: "role-token" }),
    roleId: 101,
    enabled: true,
  });
  assert.equal((await store.listTokens())[0].name, "账号一");
  assert.equal((await store.listTokens({ enabledOnly: true })).length, 1);

  await store.updateToken(token.id, { enabled: false });
  assert.equal((await store.listTokens({ enabledOnly: true })).length, 0);

  const task = await store.createTask({
    name: "每日任务",
    cron_expr: "0 8 * * *",
    selected_tasks: ["dailyBundle"],
    selected_tokens: [token.id],
    options: { boxType: 2003, boxCount: 100 },
    enabled: true,
  });
  assert.equal((await store.listTasks({ enabledOnly: true })).length, 1);
  assert.deepEqual((await store.getTask(task.id)).options, {
    boxType: 2003,
    boxCount: 100,
  });

  await store.markTaskRun(task.id, "2026-11-11T00:00:00.000Z");
  assert.equal(
    (await store.getTask(task.id)).last_run_at,
    "2026-11-11T00:00:00.000Z",
  );

  await store.appendTaskLog({
    task_id: task.id,
    token_name: token.name,
    task_type: "dailyBundle",
    status: "success",
    message: "完成",
  });
  await store.appendTaskLog({
    task_id: task.id,
    token_name: token.name,
    task_type: "dailyBundle",
    status: "error",
    message: "失败",
  });
  assert.equal((await store.listTaskLogs(10))[0].message, "失败");
  assert.deepEqual(
    (await store.listTaskLogs(10, { status: "success" })).map(
      (entry) => entry.message,
    ),
    ["完成"],
  );
  assert.deepEqual(
    (await store.listTaskLogs(10, { status: "error" })).map(
      (entry) => entry.message,
    ),
    ["失败"],
  );

  await store.appendTaskLogs([
    {
      run_id: "run-a",
      task_id: task.id,
      task_type: "startBatch",
      level: "info",
      status: "info",
      source: "browser-manual",
      message: "浏览器日志一",
    },
    {
      run_id: "run-a",
      task_id: task.id,
      task_type: "startBatch",
      level: "info",
      status: "info",
      source: "browser-manual",
      message: "浏览器日志二",
    },
  ]);
  assert.deepEqual(
    (await store.listTaskLogs(10, { runId: "run-a" })).map(
      (entry) => entry.message,
    ),
    ["浏览器日志二", "浏览器日志一"],
  );

  const settings = await store.updateBatchSettings({
    boxCount: 25,
    receiverId: "99",
  });
  assert.equal(settings.boxCount, 25);
  assert.equal(settings.receiverId, "99");
  assert.equal(await store.hasBatchSettings(), true);

  const runState = await store.saveNightmareRunState({
    taskId: task.id,
    teamId: "team-a",
    phase: "paused-cross-week",
    roomId: "room-a",
  });
  assert.equal(runState.phase, "paused-cross-week");
  assert.equal(
    (await store.getNightmareRunState(task.id)).roomId,
    "room-a",
  );

  const reloaded = createLocalStore({ dataDir: directory });
  await reloaded.init();
  assert.equal((await reloaded.listTokens())[0].id, token.id);
  assert.equal((await reloaded.listTasks())[0].id, task.id);
  assert.equal((await reloaded.getBatchSettings()).boxCount, 25);
  assert.equal(
    (await reloaded.getNightmareRunState(task.id)).phase,
    "paused-cross-week",
  );
});

test("local store keeps the newest token session and private BIN credentials", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xyzw-session-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createLocalStore({ dataDir: directory });
  await store.init();
  const older = 1_700_000_000_000;
  const newer = older + 1000;
  const token = await store.createToken({
    id: "account-a",
    name: "AIRUI-0-82539560",
    enabled: true,
    roleId: 75758961,
    token: JSON.stringify({ roleToken: "initial", connId: newer }),
  });
  assert.equal(token.expected_role_id, "82539560");

  await store.updateToken(token.id, {
    token: JSON.stringify({ roleToken: "stale", connId: older }),
    connId: older,
  });
  assert.equal(
    JSON.parse((await store.getToken(token.id)).token).roleToken,
    "initial",
  );

  await store.updateToken(token.id, {
    token: JSON.stringify({
      roleToken: "newer",
      connId: newer + 1000,
    }),
    connId: newer + 1000,
  });
  assert.equal(
    JSON.parse((await store.getToken(token.id)).token).roleToken,
    "newer",
  );

  await store.saveTokenRefreshCredential(token.id, Buffer.from("bin-secret"));
  const credential = await store.getTokenRefreshCredential(token.id);
  assert.equal(credential.bin.toString(), "bin-secret");
  const statuses = await store.listTokenRefreshCredentialStatuses();
  assert.equal(statuses[token.id].configured, true);
  assert.equal(Object.hasOwn(statuses[token.id], "bin_base64"), false);
  await store.markTokenRefreshResult(token.id, {
    success: true,
    attemptedAt: "2026-11-14T00:00:00.000Z",
    refreshedAt: "2026-11-14T00:00:00.000Z",
  });
  const status = (await store.listTokenRefreshCredentialStatuses())[token.id];
  assert.equal(status.last_refresh_at, "2026-11-14T00:00:00.000Z");

  const credentialFile = path.join(directory, "token-refresh-credentials.json");
  assert.equal((await fs.stat(credentialFile)).mode & 0o777, 0o600);

  await store.deleteToken(token.id);
  assert.equal(await store.getTokenRefreshCredential(token.id), null);
});
