import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker.js";

const corsResponse = {
  status: 200,
  headers: { "Content-Type": "application/json" },
};

async function withFetch(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("Cloudflare remote proxy injects the Render key only for protected routes", async () => {
  let captured;
  await withFetch(
    async (request) => {
      captured = request;
      return new Response(JSON.stringify({ ok: true }), corsResponse);
    },
    async () => {
      const response = await worker.fetch(
        new Request(
          "https://xyzw-web-helper-7wm.pages.dev/api/remote/tasks?limit=2",
          {
            headers: {
              "x-api-key": "browser-supplied-value",
              "x-remote-access-key": "browser-access-key",
            },
          },
        ),
        {
          RENDER_BACKEND_URL: "https://xyzw-backend-2x66.onrender.com",
          RENDER_API_KEY: "render-secret",
          REMOTE_ACCESS_KEY: "browser-access-key",
        },
      );
      assert.equal(response.status, 200);
    },
  );

  assert.equal(
    captured.url,
    "https://xyzw-backend-2x66.onrender.com/api/tasks?limit=2",
  );
  assert.equal(captured.headers.get("x-api-key"), "render-secret");
  assert.equal(captured.headers.has("x-remote-access-key"), false);
});

test("Cloudflare remote proxy keeps health public but rejects unauthenticated administration", async () => {
  let fetches = 0;
  await withFetch(
    async () => {
      fetches += 1;
      return new Response(JSON.stringify({ status: "ok" }), corsResponse);
    },
    async () => {
      const health = await worker.fetch(
        new Request("https://example.test/api/remote/health"),
        {
          RENDER_BACKEND_URL: "https://xyzw-backend.example.test",
          RENDER_API_KEY: "render-secret",
          REMOTE_ACCESS_KEY: "browser-access-key",
        },
      );
      assert.equal(health.status, 200);

      const unauthorized = await worker.fetch(
        new Request("https://example.test/api/remote/tasks"),
        {
          RENDER_BACKEND_URL: "https://xyzw-backend.example.test",
          RENDER_API_KEY: "render-secret",
          REMOTE_ACCESS_KEY: "browser-access-key",
        },
      );
      assert.equal(unauthorized.status, 401);
    },
  );
  assert.equal(fetches, 1);
});

test("Cloudflare remote proxy fails closed when its access key is missing", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/remote/tasks"),
    {
      RENDER_BACKEND_URL: "https://xyzw-backend.example.test",
      RENDER_API_KEY: "render-secret",
    },
  );
  assert.equal(response.status, 503);
});
