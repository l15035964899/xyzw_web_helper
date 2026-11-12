import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import {
  decodeLocalTokenPayload,
  syncLocalTokensToServer,
} from "../src/utils/serverTokenSync.js";

test("local token decoder accepts direct and base64 JSON", () => {
  const payload = {
    roleToken: "role-token",
    roleId: 101,
    sessId: 202,
    connId: 303,
    isRestore: 0,
  };
  assert.deepEqual(decodeLocalTokenPayload(JSON.stringify(payload)), payload);
  assert.deepEqual(
    decodeLocalTokenPayload(
      Buffer.from(JSON.stringify(payload)).toString("base64"),
    ),
    payload,
  );
});

test("sync updates existing role and adds a new account with local settings", async () => {
  const previousStorage = globalThis.localStorage;
  const settings = new Map([
    ["local-new", JSON.stringify({ arenaFormation: 4 })],
  ]);
  globalThis.localStorage = {
    getItem(key) {
      return settings.get(key.replace("daily-settings:", "")) || null;
    },
  };
  try {
    const calls = [];
    const server = [{ id: "server-old", roleId: 101, name: "旧账号" }];
    const request = async (path, options = {}) => {
      calls.push({ path, options });
      if (path === "/api/tokens" && !options.method) return [...server];
      if (path === "/api/tokens" && options.method === "POST") {
        const created = { id: options.body.id, roleId: options.body.roleId };
        server.push(created);
        return [created];
      }
      if (path.startsWith("/api/tokens/") && options.method === "PATCH") {
        return [{ id: path.split("/").at(-1), roleId: 101 }];
      }
      throw new Error(`Unexpected request: ${path}`);
    };
    const result = await syncLocalTokensToServer({
      tokens: [
        {
          id: "local-old",
          name: "已有账号",
          token: JSON.stringify({ roleToken: "old", roleId: 101 }),
        },
        {
          id: "local-new",
          name: "新账号",
          token: JSON.stringify({ roleToken: "new", roleId: 202 }),
        },
      ],
      request,
    });
    assert.deepEqual(result, { created: 1, updated: 1, failed: 0 });
    assert.ok(calls.some(({ path }) => path === "/api/tokens/server-old"));
    const createCall = calls.find(({ options }) => options.method === "POST");
    assert.equal(createCall.options.body.id, "local-new");
    assert.deepEqual(createCall.options.body.daily_settings, {
      arenaFormation: 4,
    });
  } finally {
    globalThis.localStorage = previousStorage;
  }
});
