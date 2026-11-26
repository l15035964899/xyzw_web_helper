import assert from "node:assert/strict";
import test from "node:test";

import { formatLogTime } from "../src/utils/batch/logUtils.js";

test("log timestamps include month and day", () => {
  const date = new Date(2026, 10, 23, 14, 36, 25);
  assert.equal(formatLogTime(date), "11-23 14:36:25");
});

test("time-only log values inherit the current month and day", () => {
  const reference = new Date(2026, 10, 23, 9, 5, 7);
  assert.equal(formatLogTime("14:36:25", reference), "11-23 14:36:25");
});

test("already formatted and unknown values remain readable", () => {
  assert.equal(
    formatLogTime("11-23 14:36:25"),
    "11-23 14:36:25",
  );
  assert.equal(formatLogTime("unknown"), "unknown");
});
