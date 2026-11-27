import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const batchDaily = await readFile(
  new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
  "utf8",
);
const tasksArena = await readFile(
  new URL("../src/utils/batch/tasksArena.js", import.meta.url),
  "utf8",
);

test("batch daily exposes arena ticket clearing with a 100-fight limit", () => {
  assert.match(batchDaily, /@click="showArenaClearModal = true"/);
  assert.match(batchDaily, /title="竞技场清票"/);
  assert.match(batchDaily, /v-model:value="arenaClearCount"[\s\S]*?:max="100"/);
  assert.match(batchDaily, /无论战斗胜负或单场异常都会继续下一场/);
  assert.match(batchDaily, /上海时间 06:00-22:00\s+开放/);
  assert.match(tasksArena, /timeZone: "Asia\/Shanghai"/);
  assert.match(tasksArena, /不在开放时间，跳过竞技场清票/);
});

test("scheduled charm task exposes independent layer and quantity controls", () => {
  assert.match(
    batchDaily,
    /taskForm\.selectedTasks\.includes\('nightmareCharmPurchase'\)/,
  );
  assert.match(batchDaily, /抢符咒层级与目标数量/);
  assert.match(batchDaily, /taskForm\.charmLayers\.includes\(layer\.value\)/);
  assert.match(
    batchDaily,
    /v-model:value="taskForm\.charmTargets\[layer\.value\]"/,
  );
  assert.match(batchDaily, /未勾选的层不会查询、购买或记录未抢到警告/);
  assert.match(
    batchDaily,
    /taskForm\.selectedTasks\.includes\('batchArenaClearTickets'\)/,
  );
});
