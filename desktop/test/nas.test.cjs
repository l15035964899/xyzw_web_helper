const assert = require("node:assert/strict");
const { Buffer } = require("node:buffer");
const http = require("node:http");
const test = require("node:test");
const {
  buildNasTarget,
  describeNasConnectionError,
  fetchNasGameBin,
  probeNas,
} = require("../nas.cjs");

test("NAS targets preserve a configured base path and reject non-API paths", () => {
  assert.equal(
    buildNasTarget(
      "http://nas.local:3002/xyzw/",
      "/api/tasks?limit=5",
    ).toString(),
    "http://nas.local:3002/xyzw/api/tasks?limit=5",
  );
  assert.throws(() => buildNasTarget("http://nas.local", "/health"), /API/);
});

test("connection probe validates the API key and reports account count", async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url !== "/api/tokens" || req.headers["x-api-key"] !== "valid") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end('{"error":"Unauthorized"}');
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([{ id: "one" }, { id: "two" }]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  assert.deepEqual(await probeNas({ baseUrl, apiKey: "valid" }), {
    count: 2,
    status: 200,
  });
  await assert.rejects(probeNas({ baseUrl, apiKey: "invalid" }), /API Key/);
});

test("network failures are translated into actionable Chinese messages", () => {
  assert.match(
    describeNasConnectionError({ code: "EHOSTUNREACH" }),
    /无法到达 NAS.*本地网络/,
  );
  assert.match(
    describeNasConnectionError({ code: "ECONNREFUSED" }),
    /3002 端口/,
  );
  assert.match(
    describeNasConnectionError({ code: "ETIMEDOUT" }),
    /连接 NAS 超时/,
  );
});

test("desktop fetches one account BIN through the API-key-only NAS route", async (t) => {
  const expected = Buffer.from([112, 108, 1, 2, 3]);
  const server = http.createServer((req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/api/tokens/account-a/game-bin");
    assert.equal(req.headers["x-api-key"], "valid");
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": expected.length,
    });
    res.end(expected);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  assert.deepEqual(
    await fetchNasGameBin({ baseUrl, apiKey: "valid" }, "account-a", {
      localNetworkRetryDelaysMs: [0],
    }),
    expected,
  );
});

test("desktop reports a missing NAS BIN without exposing response bodies", async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end('{"error":"secret-body"}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  await assert.rejects(
    fetchNasGameBin({ baseUrl, apiKey: "valid" }, "account-a", {
      localNetworkRetryDelaysMs: [0],
    }),
    (error) => {
      assert.match(error.message, /未保存该账号的 BIN/);
      assert.doesNotMatch(error.message, /secret-body/);
      return true;
    },
  );
});
