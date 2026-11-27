import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(
  new URL("../render-backend/server.js", import.meta.url),
  "utf8",
);

test("nightmare scheduled tasks gate every other cron and retain one catch-up", () => {
  assert.match(server, /nightmareSequenceGate\.wait\(task\.id/);
  assert.match(server, /已在十殿等待队列中，忽略重复触发/);
  assert.match(server, /十殿序列结束，开始补跑任务/);
});

test("nightmare tasks cannot be triggered from the scheduled task list", () => {
  assert.match(
    server,
    /app\.post\("\/api\/tasks\/:id\/run"[\s\S]*?parseTaskKeys\(task\)\.includes\("nightmareChallenge"\)[\s\S]*?status\(409\)/,
  );
});

test("automatic nightmare sequence is fixed to Sunday 23:50 and starts cross-week teams in parallel", () => {
  assert.match(server, /50 23 \* \* 0/);
  assert.match(server, /Promise\.allSettled\(crossWeekTeams\.map\(runTeam\)\)/);
  assert.match(server, /nightmareSingleTeam: true/);
  assert.match(server, /crossWeek: false/);
  assert.match(server, /restoreFormationsOnComplete: false/);
});

test("uncertain cleanup keeps the global gate until manual cleanup succeeds", () => {
  assert.match(server, /phase: "blocked-cleanup"/);
  assert.match(server, /releaseBlockedNightmareGateAfterCleanup/);
  assert.match(server, /holdNightmareGate/);
});
