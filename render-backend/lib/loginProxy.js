import { Readable } from "node:stream";

const PROXIES = [
  {
    prefix: "/api/hortor-ucenter",
    target: "https://ucenter-app-server.hortorgames.com",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 12; ALN-AL80 Build/HUAWEIALN-AL80; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/114.0.5735.196 Mobile Safari/537.36",
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
    },
  },
  {
    prefix: "/api/weixin-long",
    target: "https://long.open.weixin.qq.com",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220 NetType/WIFI Language/zh_CN",
      Accept: "*/*",
      Referer: "https://open.weixin.qq.com/",
    },
  },
  {
    prefix: "/api/weixin",
    target: "https://open.weixin.qq.com",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      Referer: "https://open.weixin.qq.com/",
    },
  },
  {
    prefix: "/api/hortor",
    target: "https://comb-platform.hortorgames.com",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 12; 23117RK66C Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Mobile Safari/537.36",
      Accept: "*/*",
      "Content-Type": "text/plain; charset=utf-8",
      Origin: "https://open.weixin.qq.com",
      Referer: "https://open.weixin.qq.com/",
    },
  },
].sort((left, right) => right.prefix.length - left.prefix.length);

const SKIPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "transfer-encoding",
]);

const SKIPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function resolveLoginProxy(pathname) {
  return PROXIES.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function createLoginProxyMiddleware() {
  return async (req, res, next) => {
    const proxy = resolveLoginProxy(req.path);
    if (!proxy) return next();

    const target = new URL(proxy.target);
    target.pathname = req.path.slice(proxy.prefix.length) || "/";
    target.search = req.originalUrl.includes("?")
      ? `?${req.originalUrl.split("?").slice(1).join("?")}`
      : "";

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (!value || SKIPPED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item);
      } else {
        headers.set(name, value);
      }
    }
    for (const [name, value] of Object.entries(proxy.headers)) {
      headers.set(name, value);
    }

    try {
      const response = await fetch(target, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
        redirect: "follow",
        duplex: "half",
      });
      res.status(response.status);
      for (const [name, value] of response.headers) {
        if (!SKIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) {
          res.setHeader(name, value);
        }
      }
      if (!response.body) return res.end();
      Readable.fromWeb(response.body).pipe(res);
    } catch (error) {
      if (res.headersSent) return res.end();
      res.status(502).json({
        error: "登录代理请求失败",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
