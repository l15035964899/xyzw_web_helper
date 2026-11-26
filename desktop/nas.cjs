const { Buffer } = require("node:buffer");
const http = require("node:http");
const https = require("node:https");

const LOCAL_NETWORK_ERROR_CODES = new Set([
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EHOSTDOWN",
]);
const DEFAULT_LOCAL_NETWORK_RETRY_DELAYS_MS = [0, 1500, 3000, 5000];
const MAX_GAME_BIN_BYTES = 2 * 1024 * 1024;

function normalizeBaseUrl(value) {
  const url = new URL(String(value || "").trim());
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("NAS 地址只支持 HTTP 或 HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("请不要把用户名或密码写入 NAS 地址");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/+$/, "");
}

function buildNasTarget(baseUrl, requestUrl, prefix = "http://local.invalid") {
  const base = new URL(normalizeBaseUrl(baseUrl));
  const request = new URL(requestUrl, prefix);
  if (!request.pathname.startsWith("/api/")) {
    throw new Error("Only NAS API paths can be proxied");
  }
  const basePath = base.pathname.replace(/\/+$/, "");
  return new URL(
    `${basePath}${request.pathname}${request.search}`,
    base.origin,
  );
}

function describeNasConnectionError(error) {
  const code = String(error?.code || "");
  if (["EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN"].includes(code)) {
    return "当前网络无法到达 NAS。请先确认 NAS 已开机且未休眠、电脑与 NAS 在同一局域网，并关闭路由器的 AP 隔离；然后在“系统设置 → 隐私与安全性 → 本地网络”中允许本应用。若列表中暂时没有本应用，请重启 Mac 后再试";
  }
  if (code === "ECONNREFUSED") {
    return "NAS 可以访问，但目标端口没有服务监听。请检查 3002 端口、Docker 容器和 NAS 地址";
  }
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) {
    return "无法解析 NAS 地址。请检查地址拼写、局域网 DNS 或改用 NAS 的 IP 地址";
  }
  if (code === "ETIMEDOUT") {
    return "连接 NAS 超时。请检查 NAS 是否唤醒、网络是否稳定以及防火墙设置";
  }
  if (code === "ECONNRESET") {
    return "连接 NAS 后被重置。请检查反向代理、VPN 或防火墙设置";
  }
  if (
    [
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "ERR_TLS_CERT_ALTNAME_INVALID",
    ].includes(code)
  ) {
    return "NAS 的 HTTPS 证书无效或与地址不匹配。请使用有效证书，或在局域网中改用 HTTP";
  }
  return error?.message || "连接 NAS 失败";
}

function probeNasOnce(config, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = buildNasTarget(config.baseUrl, "/api/tokens");
    const transport = target.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: {
          Accept: "application/json",
          "x-api-key": config.apiKey,
        },
        rejectUnauthorized: true,
        timeout: timeoutMs,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          if (body.length < 256_000) body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode === 401 || response.statusCode === 403) {
            reject(new Error("NAS API Key 无效或权限不足"));
            return;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`NAS 返回 HTTP ${response.statusCode}`));
            return;
          }
          let tokens;
          try {
            tokens = JSON.parse(body);
          } catch {
            reject(new Error("NAS 返回内容不是有效 JSON"));
            return;
          }
          resolve({
            count: Array.isArray(tokens) ? tokens.length : null,
            status: response.statusCode,
          });
        });
      },
    );
    request.on("timeout", () => {
      const error = new Error("连接 NAS 超时");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.on("error", (error) => {
      const connectionError = new Error(describeNasConnectionError(error));
      connectionError.code = error?.code;
      reject(connectionError);
    });
    request.end();
  });
}

async function probeNas(
  config,
  {
    timeoutMs = 15000,
    localNetworkRetryDelaysMs = DEFAULT_LOCAL_NETWORK_RETRY_DELAYS_MS,
  } = {},
) {
  let lastError;
  for (const [index, delayMs] of localNetworkRetryDelaysMs.entries()) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      return await probeNasOnce(config, { timeoutMs });
    } catch (error) {
      lastError = error;
      const canRetry =
        LOCAL_NETWORK_ERROR_CODES.has(error?.code) &&
        index < localNetworkRetryDelaysMs.length - 1;
      if (!canRetry) throw error;
    }
  }
  throw lastError;
}

function fetchNasGameBinOnce(config, tokenId, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = buildNasTarget(
      config.baseUrl,
      `/api/tokens/${encodeURIComponent(tokenId)}/game-bin`,
    );
    const transport = target.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: {
          Accept: "application/octet-stream",
          "Content-Length": "0",
          "x-api-key": config.apiKey,
        },
        rejectUnauthorized: true,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        let received = 0;
        response.on("data", (chunk) => {
          received += chunk.length;
          if (received > MAX_GAME_BIN_BYTES) {
            request.destroy(new Error("账号 BIN 数据过大"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (response.statusCode === 401 || response.statusCode === 403) {
            reject(new Error("NAS API Key 无效或权限不足"));
            return;
          }
          if (response.statusCode === 404) {
            reject(new Error("NAS 未保存该账号的 BIN，请重新同步账号"));
            return;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`NAS 返回 HTTP ${response.statusCode}`));
            return;
          }
          const body = Buffer.concat(chunks);
          if (body.length === 0) {
            reject(new Error("NAS 返回的 BIN 为空"));
            return;
          }
          resolve(body);
        });
      },
    );
    request.on("timeout", () => {
      const error = new Error("连接 NAS 超时");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.on("error", (error) => {
      const connectionError = new Error(describeNasConnectionError(error));
      connectionError.code = error?.code;
      reject(connectionError);
    });
    request.end();
  });
}

async function fetchNasGameBin(
  config,
  tokenId,
  {
    timeoutMs = 15000,
    localNetworkRetryDelaysMs = DEFAULT_LOCAL_NETWORK_RETRY_DELAYS_MS,
  } = {},
) {
  const normalizedTokenId = String(tokenId || "").trim();
  if (!/^[\w-]{1,200}$/.test(normalizedTokenId)) {
    throw new Error("账号 ID 无效");
  }
  let lastError;
  for (const [index, delayMs] of localNetworkRetryDelaysMs.entries()) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      return await fetchNasGameBinOnce(config, normalizedTokenId, {
        timeoutMs,
      });
    } catch (error) {
      lastError = error;
      const canRetry =
        LOCAL_NETWORK_ERROR_CODES.has(error?.code) &&
        index < localNetworkRetryDelaysMs.length - 1;
      if (!canRetry) throw error;
    }
  }
  throw lastError;
}

module.exports = {
  buildNasTarget,
  describeNasConnectionError,
  fetchNasGameBin,
  normalizeBaseUrl,
  probeNas,
  probeNasOnce,
};
