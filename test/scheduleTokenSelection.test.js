import assert from "node:assert/strict";
import test from "node:test";
import {
  getScheduleTokenValue,
  hasSelectedScheduleTokens,
  mapLocalTokenIdsToScheduleIds,
} from "../src/utils/scheduleTokenSelection.js";

test("scheduled group token IDs use NAS account IDs with fallbacks", () => {
  const tokens = [
    { id: "local-a", serverAccountId: "server-a" },
    { id: "local-b", nasId: "server-b" },
    { id: "local-c", serverAccountId: "local-c" },
  ];
  const tokenIdMap = { "local-c": "server-c" };

  assert.equal(
    getScheduleTokenValue(tokens[2], tokenIdMap),
    "server-c",
  );
  assert.deepEqual(
    mapLocalTokenIdsToScheduleIds(
      ["local-a", "local-b", "local-c", "missing"],
      tokens,
      tokenIdMap,
    ),
    ["server-a", "server-b", "server-c"],
  );
});

test("scheduled group selection compares all IDs as strings", () => {
  assert.equal(hasSelectedScheduleTokens([1, "two"], ["1", 2]), false);
  assert.equal(hasSelectedScheduleTokens([1, "two"], ["1", "two"]), true);
  assert.equal(hasSelectedScheduleTokens([], []), false);
});
