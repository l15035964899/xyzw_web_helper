import assert from "node:assert/strict";
import test from "node:test";
import worker, { __test } from "../scheduler-worker.js";

test("Cloudflare cron maps Shanghai daily and arena times to their task ids", () => {
  const env = { DAILY_TASK_ID: "daily-id", ARENA_TASK_ID: "arena-id" };
  assert.equal(__test.taskIdForCron({ cron: "1 16 * * *" }, env), "daily-id");
  assert.equal(__test.taskIdForCron({ cron: "10 16 * * *" }, env), "daily-id");
  assert.equal(__test.taskIdForCron({ cron: "0 0 * * *" }, env), "arena-id");
  assert.equal(__test.taskIdForCron({ cron: "10 0 * * *" }, env), "arena-id");
});

test("scheduler calls the authenticated once-per-day Render endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ status: "running" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await worker.scheduled(
      { cron: "1 16 * * *" },
      {
        DAILY_TASK_ID: "daily-id",
        ARENA_TASK_ID: "arena-id",
        RENDER_BACKEND_URL: "https://backend.example.test",
        RENDER_API_KEY: "render-key",
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    captured.url,
    "https://backend.example.test/api/tasks/daily-id/run-once",
  );
  assert.equal(captured.options.headers["X-API-Key"], "render-key");
});
