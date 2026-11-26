const assert = require("node:assert/strict");
const { Buffer } = require("node:buffer");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { startServer } = require("../server.cjs");

async function staticFixture(t, nasConfig = null) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xyzw-desktop-server-"));
  await fs.writeFile(path.join(root, "index.html"), "<html>APP</html>");
  await fs.mkdir(path.join(root, "assets"));
  await fs.writeFile(path.join(root, "assets/main.js"), "console.log('ok')");
  const service = await startServer({
    root,
    port: 0,
    getNasConfig: () => nasConfig,
  });
  t.after(async () => {
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return service;
}

test("desktop server supports SPA routes and static assets", async (t) => {
  const service = await staticFixture(t);
  const page = await fetch(`${service.origin}/admin/dashboard`, {
    headers: { accept: "text/html" },
  });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /APP/);
  const asset = await fetch(`${service.origin}/assets/main.js`);
  assert.match(asset.headers.get("content-type"), /javascript/);
});

test("desktop server rejects foreign origins and requires NAS configuration", async (t) => {
  const service = await staticFixture(t);
  assert.equal(
    (
      await fetch(`${service.origin}/api/tokens`, {
        headers: { origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(`${service.origin}/api/tokens`)).status, 503);
  assert.equal(
    (await fetch(`${service.origin}/`, { method: "POST" })).status,
    405,
  );
});

test("desktop server streams NAS API requests with the configured API key", async (t) => {
  const received = [];
  const upstream = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      received.push({
        method: req.method,
        path: req.url,
        body,
        apiKey: req.headers["x-api-key"],
        origin: req.headers.origin,
        referer: req.headers.referer,
        cookie: req.headers.cookie,
      });
      res.writeHead(201, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));

  const service = await staticFixture(t, {
    baseUrl: `http://127.0.0.1:${upstream.address().port}`,
    apiKey: "desktop-key",
  });
  const response = await fetch(`${service.origin}/api/tasks?limit=5`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "browser-cookie=1",
      Origin: service.origin,
      Referer: `${service.origin}/admin`,
      "x-api-key": "renderer-key-must-not-be-used",
    },
    body: '{"enabled":true}',
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(received, [
    {
      method: "POST",
      path: "/api/tasks?limit=5",
      body: '{"enabled":true}',
      apiKey: "desktop-key",
      origin: undefined,
      referer: undefined,
      cookie: undefined,
    },
  ]);
});

test("desktop renderer cannot fetch game BIN through the local proxy", async (t) => {
  let upstreamCalls = 0;
  const upstream = http.createServer((_req, res) => {
    upstreamCalls += 1;
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(Buffer.from([112, 108]));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));

  const service = await staticFixture(t, {
    baseUrl: `http://127.0.0.1:${upstream.address().port}`,
    apiKey: "desktop-key",
  });
  const response = await fetch(
    `${service.origin}/api/tokens/account-a/game-bin`,
    {
      method: "POST",
      headers: { Origin: service.origin },
    },
  );
  assert.equal(response.status, 403);
  assert.equal(upstreamCalls, 0);
});

test("fixed local port fails clearly when already occupied", async (t) => {
  const service = await staticFixture(t);
  await assert.rejects(
    startServer({
      root: path.join(os.tmpdir()),
      port: new URL(service.origin).port,
    }),
    { code: "EADDRINUSE" },
  );
});
