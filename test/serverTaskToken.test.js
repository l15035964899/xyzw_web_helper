import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserTokenValue } from "../src/utils/serverTaskToken.js";

test("server tokens retain the browser WebSocket session fields", () => {
  const value = JSON.parse(
    createBrowserTokenValue({
      roleToken: "role-token",
      roleId: 101,
      sessId: 202,
      connId: 303,
      isRestore: 0,
    }),
  );
  assert.deepEqual(value, {
    roleToken: "role-token",
    roleId: 101,
    sessId: 202,
    connId: 303,
    isRestore: 0,
  });
});
