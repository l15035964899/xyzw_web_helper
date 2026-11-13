import assert from "node:assert/strict";
import test from "node:test";
import { getMaintenanceDelay } from "../render-backend/lib/maintenanceWindow.js";

test("Friday maintenance delays tasks until 07:05 Shanghai time", () => {
  const result = getMaintenanceDelay(
    new Date("2026-11-12T21:05:00.000Z"), // Friday 05:05 in Shanghai.
  );
  assert.equal(result.resumeAt.toISOString(), "2026-11-12T23:05:00.000Z");
  assert.equal(result.delayMs, 2 * 60 * 60 * 1000);
});

test("Friday 06:10 maintenance wait is only until 07:05", () => {
  const result = getMaintenanceDelay(new Date("2026-11-12T22:10:00.000Z"));
  assert.equal(result.delayMs, 55 * 60 * 1000);
});

test("tasks outside Friday 05:00-07:05 run normally", () => {
  assert.equal(
    getMaintenanceDelay(new Date("2026-11-12T20:59:00.000Z")).delayMs,
    0,
  );
  assert.equal(
    getMaintenanceDelay(new Date("2026-11-12T23:05:00.000Z")).delayMs,
    0,
  );
  assert.equal(
    getMaintenanceDelay(new Date("2026-11-13T21:05:00.000Z")).delayMs,
    0,
  );
});
