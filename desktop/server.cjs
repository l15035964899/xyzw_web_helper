const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { pipeline } = require("node:stream");
const { buildNasTarget } = require("./nas.cjs");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
};

const HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function cleanHeaders(input) {
  const headers = { ...input };
  const connection = String(headers.connection || "")
    .split(",")
    .map((header) => header.trim().toLowerCase());
  for (const key of [...HOP_HEADERS, ...connection]) delete headers[key];
  return headers;
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

async function startServer({
  root,
  port = 47831,
  host = "127.0.0.1",
  getNasConfig = () => null,
  log = () => {},
}) {
  root = await fsp.realpath(root);
  let origin;

  const proxyNas = (req, res, config) => {
    let target;
    try {
      target = buildNasTarget(config.baseUrl, req.url, origin);
    } catch {
      sendText(res, 400, "Invalid NAS API request");
      return;
    }
    const headers = cleanHeaders(req.headers);
    for (const key of [
      "origin",
      "referer",
      "cookie",
      "host",
      "authorization",
      "x-api-key",
    ]) {
      delete headers[key];
    }
    headers.host = target.host;
    headers["x-api-key"] = config.apiKey;
    const transport = target.protocol === "https:" ? https : http;
    const upstream = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers,
        rejectUnauthorized: true,
      },
      (response) => {
        const responseHeaders = cleanHeaders(response.headers);
        for (const name of Object.keys(responseHeaders)) {
          if (name.startsWith("access-control-")) delete responseHeaders[name];
        }
        res.writeHead(response.statusCode, responseHeaders);
        pipeline(response, res, () => {});
      },
    );
    upstream.setTimeout(90000, () =>
      upstream.destroy(new Error("NAS API timeout")),
    );
    upstream.on("error", (error) => {
      log(`NAS API failed: ${error.code || error.message}`);
      if (!res.headersSent) sendText(res, 502, "NAS connection failed");
      else res.destroy();
    });
    res.on("close", () => upstream.destroy());
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin && req.headers.origin !== origin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      ) {
        return sendText(res, 403, "Local application requests only");
      }
      const rawPath = String(req.url || "").split("?")[0];
      const decoded = decodeURIComponent(rawPath);
      if (
        !decoded.startsWith("/") ||
        decoded.includes("\\") ||
        decoded.includes("\0") ||
        decoded.split("/").includes("..")
      ) {
        return sendText(res, 403, "Forbidden");
      }
      if (
        req.method === "POST" &&
        /^\/api\/tokens\/[^/]+\/game-bin$/.test(decoded)
      ) {
        return sendText(res, 403, "Sensitive endpoint is IPC-only");
      }
      if (decoded === "/api" || decoded.startsWith("/api/")) {
        const config = getNasConfig();
        if (!config?.baseUrl || !config?.apiKey) {
          return sendText(res, 503, "NAS is not configured");
        }
        return proxyNas(req, res, config);
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        return sendText(res, 405, "Method not allowed");
      }
      let file = path.resolve(root, `.${decoded}`);
      if (
        decoded.split("/").some((part) => part.startsWith(".")) ||
        decoded === "/_worker.js"
      ) {
        return sendText(res, 403, "Forbidden");
      }
      let stat = await fsp.stat(file).catch(() => null);
      if (stat?.isDirectory()) {
        file = path.join(file, "index.html");
        stat = await fsp.stat(file).catch(() => null);
      }
      if (!stat?.isFile()) {
        if (
          path.extname(decoded) ||
          !req.headers.accept?.includes("text/html")
        ) {
          return sendText(res, 404, "Not found");
        }
        file = path.join(root, "index.html");
        stat = await fsp.stat(file);
      }
      const realFile = await fsp.realpath(file);
      if (!realFile.startsWith(root + path.sep)) {
        return sendText(res, 403, "Forbidden");
      }
      res.writeHead(200, {
        "Content-Type":
          MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Content-Length": stat.size,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
      });
      if (req.method === "HEAD") return res.end();
      pipeline(fs.createReadStream(realFile), res, () => {});
    } catch (error) {
      if (!res.headersSent) {
        sendText(res, error instanceof URIError ? 400 : 500, "Request failed");
      } else {
        res.destroy();
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(port), host, () => {
      origin = `http://${host}:${server.address().port}`;
      server.removeListener("error", reject);
      resolve();
    });
  });
  server.on("error", () => log("Local HTTP service error"));
  return {
    origin,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

module.exports = { cleanHeaders, startServer };
