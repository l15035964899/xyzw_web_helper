import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import {
  bon,
  encode,
  getEnc,
} from "../render-backend/lib/bonProtocol.js";
import {
  createTokenRefreshManager,
  getTokenAgeMs,
  refreshTokenFromBin,
  tokenNeedsRefresh,
} from "../render-backend/lib/tokenRefresh.js";

const HOUR = 60 * 60 * 1000;

test("token age uses connId and refreshes before 24 hours", () => {
  const now = 1_800_000_000_000;
  const token = {
    token: JSON.stringify({
      roleToken: "secret",
      connId: now - 21 * HOUR,
    }),
  };
  assert.equal(getTokenAgeMs(token, now), 21 * HOUR);
  assert.equal(tokenNeedsRefresh(token, now, 20 * HOUR), true);
  assert.equal(tokenNeedsRefresh(token, now, 22 * HOUR), false);
  assert.equal(tokenNeedsRefresh({ token: "opaque" }, now, 20 * HOUR), true);
});

test("BIN auth exchange creates a fresh role token session", async () => {
  const responseBody = encode(
    {
      body: bon.encode({ roleToken: "fresh-role-token", roleId: 101 }),
      code: 0,
      seq: 1,
    },
    getEnc("x"),
  );
  const requests = [];
  const now = 1_800_000_000_000;
  const result = await refreshTokenFromBin(Buffer.from("bin-data"), {
    now: () => now,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(responseBody, { status: 200 });
    },
  });
  const payload = JSON.parse(result.token);

  assert.equal(requests[0].url, "https://xxz-xyzw.hortorgames.com/login/authuser?_seq=1");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(payload.roleToken, "fresh-role-token");
  assert.equal(payload.roleId, 101);
  assert.ok(payload.connId >= now);
  assert.ok(payload.connId < now + 10);
  assert.ok(payload.sessId >= now * 100);
  assert.ok(payload.sessId < now * 100 + 100);
  assert.equal(payload.isRestore, 0);
});

test("refresh manager updates due tokens and reports missing credentials", async () => {
  const now = 1_800_000_000_000;
  const tokens = [
    {
      id: "due",
      name: "到期账号",
      roleId: 101,
      enabled: true,
      token: JSON.stringify({
        roleToken: "old-role-token",
        connId: now - 21 * HOUR,
      }),
    },
    {
      id: "missing",
      name: "缺少凭据",
      roleId: 102,
      enabled: true,
      token: JSON.stringify({
        roleToken: "old-role-token-2",
        connId: now - 22 * HOUR,
      }),
    },
  ];
  const updates = [];
  const results = [];
  const logs = [];
  const manager = createTokenRefreshManager({
    dataStore: {
      listTokens: async () => tokens,
      getTokenRefreshCredential: async (id) =>
        id === "due" ? { bin: Buffer.from("credential") } : null,
      updateToken: async (id, patch) => updates.push({ id, patch }),
      markTokenRefreshResult: async (id, result) =>
        results.push({ id, result }),
    },
    addLog: (...entry) => logs.push(entry),
    now: () => now,
    sleep: async () => {},
    refreshDelayMs: 0,
    refresh: async () => ({
      token: JSON.stringify({
        roleToken: "new-role-token",
        roleId: 101,
        connId: now + 1,
        sessId: now * 100 + 1,
        isRestore: 0,
      }),
      payload: {
        roleId: 101,
        connId: now + 1,
        sessId: now * 100 + 1,
        isRestore: 0,
      },
      refreshedAt: new Date(now).toISOString(),
    }),
  });

  const summary = await manager.run();
  assert.deepEqual(summary, {
    checked: 2,
    due: 2,
    refreshed: 1,
    missingCredentials: 1,
    failed: 0,
  });
  assert.equal(updates[0].id, "due");
  assert.equal(JSON.parse(updates[0].patch.token).roleToken, "new-role-token");
  assert.equal(results[0].id, "due");
  assert.equal(logs.some((entry) => entry[2].includes("缺少 BIN")), true);
});
