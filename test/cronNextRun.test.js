import assert from "node:assert/strict";
import test from "node:test";
import { formatCronRun, getNextCronRun } from "../src/utils/cronNextRun.js";

test("next cron run respects the Shanghai five-hour schedule", () => {
  const next = getNextCronRun("0 */5 * * *", {
    now: new Date("2026-11-12T03:52:00.000Z"),
  });
  assert.equal(next.toISOString(), "2026-11-12T07:00:00.000Z");
  assert.match(formatCronRun(next), /15:00:00/);
});

test("next cron run supports English weekday names", () => {
  const next = getNextCronRun("30 0 * * MON", {
    now: new Date("2026-11-12T03:52:00.000Z"),
  });
  assert.equal(next.toISOString(), "2026-11-15T16:30:00.000Z");
});

test("invalid cron expressions have no next run", () => {
  assert.equal(getNextCronRun("0 0 *"), null);
  assert.equal(getNextCronRun("90 0 * * *"), null);
});
