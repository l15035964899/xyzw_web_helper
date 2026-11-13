import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeClientTaskLog,
  sanitizeLogMessage,
} from "../render-backend/lib/logSanitizer.js";

test("task logs redact credential-like values", () => {
  const message = sanitizeLogMessage(
    '{"roleToken":"abc","sessId":"def","password":"ghi","message":"ok"}',
  );
  assert.doesNotMatch(message, /abc|def|ghi/);
  assert.match(message, /\[REDACTED\]/);
});

test("client task logs are normalized to the persistent schema", () => {
  const entry = normalizeClientTaskLog({
    level: "warning",
    message: "slow",
    task_id: "task-a",
    account_name: "账号一",
  });
  assert.equal(entry.status, "warn");
  assert.equal(entry.level, "warning");
  assert.equal(entry.task_id, "task-a");
  assert.equal(entry.token_name, "账号一");
  assert.equal(entry.source, "browser-manual");
});
