import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(
  new URL("../render-backend/server.js", import.meta.url),
  "utf8",
);

test("NAS push APIs cover start, status, stop and manual torch", () => {
  assert.match(server, /app\.post\("\/api\/pushing\/runs"/);
  assert.match(server, /app\.get\("\/api\/pushing\/status"/);
  assert.match(server, /app\.get\("\/api\/pushing\/runs\/:id"/);
  assert.match(server, /app\.post\("\/api\/pushing\/runs\/:id\/stop"/);
  assert.match(server, /app\.post\("\/api\/pushing\/runs\/:id\/use-torch"/);
  assert.match(server, /await pushSessionManager\.restore\(\)/);
});
