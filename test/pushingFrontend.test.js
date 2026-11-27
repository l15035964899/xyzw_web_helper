import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pushingLevels = await readFile(
  new URL("../src/views/PushingLevels.vue", import.meta.url),
  "utf8",
);
const batchDaily = await readFile(
  new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
  "utf8",
);

test("main push page keeps NAS and browser modes with NAS as default", () => {
  assert.match(
    pushingLevels,
    /localStorage\.getItem\("push-execution-mode"\) \|\| "nas"/,
  );
  assert.match(pushingLevels, /<n-radio value="nas">NAS 推图<\/n-radio>/);
  assert.match(pushingLevels, /<n-radio value="browser">浏览器<\/n-radio>/);
  assert.match(pushingLevels, /开始 NAS 推图/);
  assert.match(pushingLevels, /强制停止 NAS/);
});

test("NAS push controls cap concurrency at five and expose recovery settings", () => {
  assert.match(
    pushingLevels,
    /v-model:value="nasMaxConcurrent"[\s\S]*?:max="5"/,
  );
  assert.match(pushingLevels, /v-model:value="autoUpgradeHangup"/);
  assert.match(
    pushingLevels,
    /v-model:value="kickReloginDelayMinutes"[\s\S]*?:max="120"/,
  );
  assert.match(pushingLevels, /自动任务需要任一推图账号时/);
  assert.match(pushingLevels, /手动停止会立即断开连接/);
  assert.match(pushingLevels, /isAccountInActiveNasRun/);
});

test("NAS page is a control surface and never stops the run during unmount", () => {
  const unmount = pushingLevels.match(
    /onBeforeUnmount\(\(\) => \{([\s\S]*?)\n\}\);/,
  )?.[1];
  assert.ok(unmount);
  assert.doesNotMatch(unmount, /stopPushingRun|stopActiveNasRun/);
  assert.match(unmount, /clearInterval\(nasPollTimer\)/);
});

test("batch daily does not add a second NAS push entry", () => {
  assert.doesNotMatch(batchDaily, /pushing\/runs|NAS 推图/i);
});
