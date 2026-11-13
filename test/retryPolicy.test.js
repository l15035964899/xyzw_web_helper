import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldRetryTokenAttempt,
  TOKEN_RETRY_DELAYS_MS,
} from "../render-backend/lib/retryPolicy.js";

test("pure connection failures before any success are retryable", () => {
  assert.equal(
    shouldRetryTokenAttempt({ successCount: 0, error: "未连接" }),
    true,
  );
  assert.equal(
    shouldRetryTokenAttempt({
      successCount: 0,
      error: new Error("连接关闭: 1006"),
    }),
    true,
  );
  assert.deepEqual(TOKEN_RETRY_DELAYS_MS, [5000, 15000]);
});

test("business errors and partially successful accounts are not retried", () => {
  assert.equal(
    shouldRetryTokenAttempt({
      successCount: 0,
      error: "[400010] 物品数量不足",
    }),
    false,
  );
  assert.equal(
    shouldRetryTokenAttempt({ successCount: 1, error: "未连接" }),
    false,
  );
});
