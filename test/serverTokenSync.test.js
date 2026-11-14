import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import {
  arrayBufferToBase64,
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

test("sync uploads the local BIN as a private refresh credential", async () => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null };
  try {
    const bin = new Uint8Array([1, 2, 3, 4, 5]);
    const calls = [];
    const server = [
      { id: "server-a", roleId: 101, name: "账号一", enabled: true },
    ];
    const request = async (path, options = {}) => {
      calls.push({ path, options });
      if (path === "/api/tokens" && !options.method) return [...server];
      if (path.endsWith("/refresh-credential") && options.method === "PUT") {
        return { ok: true };
      }
      if (path.startsWith("/api/tokens/") && options.method === "PATCH") {
        return [{ ...server[0], importMethod: "wxQrcode" }];
      }
      throw new Error(`Unexpected request: ${path}`);
    };
    const result = await syncLocalTokensToServer({
      tokens: [
        {
          id: "local-a",
          name: "账号一",
          roleId: 101,
          importMethod: "wxQrcode",
          token: JSON.stringify({
            roleToken: "role-token",
            roleId: 101,
            connId: 1_800_000_000_000,
          }),
        },
      ],
      request,
      getRefreshCredential: async () => bin.buffer,
    });

    assert.equal(result.refreshCredentialsConfigured, 1);
    assert.equal(result.refreshCredentialsMissing, 0);
    assert.equal(result.refreshCredentialsFailed, 0);
    assert.equal(arrayBufferToBase64(bin.buffer), "AQIDBAU=");
    const upload = calls.find(({ path }) => path.endsWith("/refresh-credential"));
    assert.equal(upload.options.body.bin_base64, "AQIDBAU=");
    const update = calls.find(({ options }) => options.method === "PATCH");
    assert.equal(update.options.body.importMethod, "wxQrcode");
  } finally {
    globalThis.localStorage = previousStorage;
  }
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
    const server = [
      { id: "server-old", roleId: 101, name: "旧账号", enabled: false },
    ];
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
          roleId: 101,
          token: JSON.stringify({ roleToken: "old", roleId: 999 }),
        },
        {
          id: "local-new",
          name: "新账号",
          roleId: 202,
          token: JSON.stringify({ roleToken: "new", roleId: 888 }),
        },
      ],
      request,
    });
    assert.equal(result.created, 1);
    assert.equal(result.updated, 1);
    assert.equal(result.failed, 0);
    assert.deepEqual(result.tokenIdMap, {
      "local-old": "server-old",
      "local-new": "local-new",
    });
    assert.equal(result.accounts.length, 2);
    assert.ok(calls.some(({ path }) => path === "/api/tokens/server-old"));
    const updateCall = calls.find(
      ({ path, options }) =>
        path === "/api/tokens/server-old" && options.method === "PATCH",
    );
    assert.equal(updateCall.options.body.enabled, false);
    const createCall = calls.find(({ options }) => options.method === "POST");
    assert.equal(createCall.options.body.id, "local-new");
    assert.equal(createCall.options.body.roleId, 202);
    assert.deepEqual(createCall.options.body.daily_settings, {
      arenaFormation: 4,
    });
  } finally {
    globalThis.localStorage = previousStorage;
  }
});
