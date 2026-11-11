import assert from "node:assert/strict";
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
    enabled: true,
  });
  assert.equal((await store.listTasks({ enabledOnly: true })).length, 1);

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
  assert.equal((await store.listTaskLogs(10))[0].message, "完成");

  const reloaded = createLocalStore({ dataDir: directory });
  await reloaded.init();
  assert.equal((await reloaded.listTokens())[0].id, token.id);
  assert.equal((await reloaded.listTasks())[0].id, task.id);
});
