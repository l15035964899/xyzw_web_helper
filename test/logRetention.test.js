import assert from "node:assert/strict";
import test from "node:test";
import {
  getShanghaiDayStart,
  getShanghaiLogRetentionCutoff,
} from "../render-backend/lib/logRetention.js";

test("daily log cleanup cutoff is Shanghai midnight", () => {
  assert.equal(
    getShanghaiDayStart(new Date("2026-11-13T16:00:00.000Z")).toISOString(),
    "2026-11-13T16:00:00.000Z",
  );
  assert.equal(
    getShanghaiDayStart(new Date("2026-11-14T15:59:59.999Z")).toISOString(),
    "2026-11-13T16:00:00.000Z",
  );
});

test("two-day retention keeps today and yesterday", () => {
  assert.equal(
    getShanghaiLogRetentionCutoff(
      new Date("2026-11-13T16:00:00.000Z"),
    ).toISOString(),
    "2026-11-12T16:00:00.000Z",
  );
  assert.equal(
    getShanghaiLogRetentionCutoff(
      new Date("2026-11-14T15:59:59.999Z"),
    ).toISOString(),
    "2026-11-12T16:00:00.000Z",
  );
  assert.equal(
    getShanghaiLogRetentionCutoff(
      new Date("2026-11-14T16:00:00.000Z"),
    ).toISOString(),
    "2026-11-13T16:00:00.000Z",
  );
});
