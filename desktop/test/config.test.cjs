const assert = require("node:assert/strict");
const { Buffer } = require("node:buffer");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createConfigStore, normalizeBaseUrl } = require("../config.cjs");

function encryptedSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => {
      const text = value.toString("utf8");
      if (!text.startsWith("encrypted:")) throw new Error("bad ciphertext");
      return text.slice("encrypted:".length);
    },
  };
}

test("NAS configuration encrypts its API key and preserves an existing key", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "xyzw-desktop-config-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "desktop-config.json");
  const store = createConfigStore({
    filePath,
    safeStorage: encryptedSafeStorage(),
  });

  await store.save({
    baseUrl: "http://192.168.0.222:3002/",
    apiKey: "secret-key",
  });
  const raw = await fs.readFile(filePath, "utf8");
  assert.doesNotMatch(raw, /secret-key/);
  assert.deepEqual(await store.load(), {
    baseUrl: "http://192.168.0.222:3002",
    apiKey: "secret-key",
  });

  await store.save(
    { baseUrl: "https://nas.example.com", apiKey: "" },
    await store.load(),
  );
  assert.equal((await store.load()).apiKey, "secret-key");
});

test("NAS URL validation rejects credentials and unsupported protocols", () => {
  assert.equal(
    normalizeBaseUrl("http://nas.local:3002/"),
    "http://nas.local:3002",
  );
  assert.throws(() => normalizeBaseUrl("ftp://nas.local"), /HTTP 或 HTTPS/);
  assert.throws(
    () => normalizeBaseUrl("http://user:pass@nas.local"),
    /用户名或密码/,
  );
});

test("tampered encrypted configuration is rejected", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "xyzw-desktop-config-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "desktop-config.json");
  await fs.writeFile(
    filePath,
    JSON.stringify({
      version: 1,
      baseUrl: "http://nas.local",
      encryptedApiKey: Buffer.from("invalid").toString("base64"),
    }),
  );
  const store = createConfigStore({
    filePath,
    safeStorage: encryptedSafeStorage(),
  });
  await assert.rejects(store.load(), /解密失败/);
});
