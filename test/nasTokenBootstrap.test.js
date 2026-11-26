import assert from "node:assert/strict";
import test from "node:test";
import * as roleIdentity from "../src/utils/roleIdentity.js";
import { loadModule } from "./helpers/loadModule.js";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

test("NAS accounts reconcile by roleId without duplicating local tokens", async () => {
  const localStorage = storage();
  const module = await loadModule(
    new URL("../src/utils/nasTokenBootstrap.js", import.meta.url),
    {
      "@/api/serverTasks": {
        loadServerConnection: () => ({}),
        serverRequest: async (_path, options) => options,
      },
      "./serverTaskToken.js": {
        createBrowserTokenValue: (payload) => JSON.stringify(payload),
      },
      "./serverTokenSync.js": {
        decodeLocalTokenPayload: (value) => JSON.parse(value),
      },
      "./roleIdentity.js": roleIdentity,
    },
    { localStorage },
  );

  const tokens = [
    {
      id: "local-a",
      name: "本机名称",
      roleId: 101,
      token: "old",
      server: "s1",
    },
  ];
  const tokenStore = {
    get gameTokens() {
      return tokens;
    },
    updateToken(id, patch) {
      const item = tokens.find((token) => token.id === id);
      Object.assign(item, patch);
      return true;
    },
    addToken(token) {
      tokens.push({ ...token, createdAt: "now" });
      return tokens.at(-1);
    },
  };
  const payload = (roleId) =>
    JSON.stringify({ roleToken: `token-${roleId}`, roleId });
  const result = await module.reconcileNasTokens({
    tokenStore,
    request: async () => [
      {
        id: "server-a",
        roleId: 101,
        name: "服务端名称",
        token: payload(101),
        daily_settings: { arenaFormation: 4 },
      },
      {
        id: "server-b",
        roleId: 202,
        name: "新账号",
        token: payload(202),
        daily_settings: { towerFormation: 3 },
      },
    ],
  });

  assert.equal(tokens.length, 2);
  assert.equal(result.tokenIdMap["local-a"], "server-a");
  assert.equal(tokens[0].name, "本机名称");
  assert.equal(tokens[0].serverAccountId, "server-a");
  assert.equal(tokens[1].id, "server-b");
  assert.deepEqual(JSON.parse(localStorage.getItem("daily-settings:local-a")), {
    arenaFormation: 4,
  });
  assert.deepEqual(
    JSON.parse(localStorage.getItem("daily-settings:server-b")),
    { towerFormation: 3 },
  );
});
