import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serverSource = await readFile(
  new URL("../render-backend/server.js", import.meta.url),
  "utf8",
);

test("task execution automatically repairs a mismatched role before continuing", () => {
  assert.match(serverSource, /检测到角色身份异常，正在使用 NAS BIN 自动修复/);
  assert.match(
    serverSource,
    /await repairTokenIdentityFromCredential\(token\)/,
  );
  assert.match(
    serverSource,
    /return await runTokenAttempt\(repairedToken,\s*\{\s*allowAutomaticRepair:\s*false,\s*\}\)/,
  );
  assert.match(serverSource, /自动修复失败/);
});
