import assert from "node:assert/strict";
import test from "node:test";
import {
  getNextCronRun,
  getNextCronRuns,
  previewCronExpression,
} from "../render-backend/lib/cronSchedule.js";

test("NAS cron preview returns Shanghai wall-clock matches", () => {
  const now = new Date("2026-11-13T00:00:00.000Z");
  const runs = getNextCronRuns("10 6 * * *", { now, count: 2 });
  assert.deepEqual(
    runs.map((date) => date.toISOString()),
    ["2026-11-13T22:10:00.000Z", "2026-11-14T22:10:00.000Z"],
  );
});

test("NAS cron preview supports standard names and ranged syntax", () => {
  const now = new Date("2026-11-13T00:00:00.000Z");
  const monday = getNextCronRun("0 8 * * MON", { now });
  assert.equal(monday?.toISOString(), "2026-11-16T00:00:00.000Z");
  const preview = previewCronExpression("0 8,20 * * *", { now, count: 3 });
  assert.equal(preview.valid, true);
  assert.equal(preview.nextRuns.length, 3);
});

test("NAS cron preview rejects unsupported extended syntax", () => {
  const preview = previewCronExpression("0 8 * * 5#2");
  assert.equal(preview.valid, false);
  assert.match(preview.message, /扩展/);
});
