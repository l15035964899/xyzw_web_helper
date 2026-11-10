const REMOTE_PREFIX = "/api/remote";
const COLD_START_DELAYS_MS = [5000, 10000, 15000, 20000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function remotePath(pathname) {
  const suffix = pathname.slice(REMOTE_PREFIX.length) || "/health";
  if (suffix === "/") return "/health";
  if (!/^\/[\w/-]*$/.test(suffix)) return null;
  return suffix === "/health" ? "/health" : `/api${suffix}`;
}

async function handleRemoteRequest(request, env, corsHeaders) {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
    return jsonResponse({ error: "Method Not Allowed" }, 405, corsHeaders);
  }
  if (!env.RENDER_BACKEND_URL) {
    return jsonResponse(
      { error: "Render backend is not configured" },
      503,
      corsHeaders,
    );
  }

  const url = new URL(request.url);
  const upstreamPath = remotePath(url.pathname);
  if (!upstreamPath) {
    return jsonResponse({ error: "Invalid remote path" }, 400, corsHeaders);
  }

  const isHealthCheck = upstreamPath === "/health";
  if (!isHealthCheck) {
    const expectedAccessKey = env.REMOTE_ACCESS_KEY;
    const providedAccessKey = request.headers.get("x-remote-access-key");
    if (!expectedAccessKey) {
      return jsonResponse(
        { error: "Remote access is not configured" },
        503,
        corsHeaders,
      );
    }
    if (providedAccessKey !== expectedAccessKey) {
      return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
    }
    if (!env.RENDER_API_KEY) {
      return jsonResponse(
        { error: "Render API key is not configured" },
        503,
        corsHeaders,
      );
    }
  }

  const target = new URL(env.RENDER_BACKEND_URL);
  target.pathname = upstreamPath;
  target.search = url.search;

  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("host");
  headers.delete("authorization");
  headers.delete("x-remote-access-key");
  if (!isHealthCheck) headers.set("x-api-key", env.RENDER_API_KEY);

  try {
    const body = ["GET", "HEAD"].includes(request.method)
      ? undefined
      : request.body;
    const createRequest = () =>
      new Request(target.toString(), {
        method: request.method,
        headers,
        body,
        redirect: "manual",
      });
    let response;
    const canRetry = ["GET", "HEAD"].includes(request.method);
    for (
      let attempt = 0;
      attempt <= COLD_START_DELAYS_MS.length;
      attempt += 1
    ) {
      response = await fetch(createRequest());
      const shouldRetry =
        canRetry &&
        attempt < COLD_START_DELAYS_MS.length &&
        [502, 503, 504].includes(response.status);
      if (!shouldRetry) break;
      await response.body?.cancel();
      await sleep(COLD_START_DELAYS_MS[attempt]);
    }
    const responseHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      responseHeaders.set(key, value);
    }
    responseHeaders.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "Render backend request failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      502,
      corsHeaders,
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Requested-With, X-Remote-Access-Key",
    };

    // Handle OPTIONS request
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (
      url.pathname === REMOTE_PREFIX ||
      url.pathname.startsWith(`${REMOTE_PREFIX}/`)
    ) {
      return handleRemoteRequest(request, env, corsHeaders);
    }

    // Proxy configuration
    const proxies = [
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
            "Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN",
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
          Host: "comb-platform.hortorgames.com",
          Connection: "keep-alive",
          "Content-Type": "text/plain; charset=utf-8",
          Origin: "https://open.weixin.qq.com",
          Referer: "https://open.weixin.qq.com/",
        },
      },
    ].sort((a, b) => b.prefix.length - a.prefix.length); // Sort by length descending to match longest prefix first

    // Find matching proxy
    const proxy = proxies.find((p) => url.pathname.startsWith(p.prefix));

    if (proxy) {
      // Construct new URL
      const targetUrl = new URL(proxy.target);
      targetUrl.pathname = url.pathname.replace(proxy.prefix, "") || "/";
      targetUrl.search = url.search;

      // Prepare request headers
      const newHeaders = new Headers(request.headers);

      // Override headers based on proxy config
      Object.entries(proxy.headers).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });

      // Create new request
      const newRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: "follow",
      });

      try {
        const response = await fetch(newRequest);

        // Re-create response to add CORS headers
        const newResponse = new Response(response.body, response);
        Object.entries(corsHeaders).forEach(([key, value]) => {
          newResponse.headers.set(key, value);
        });

        return newResponse;
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Serve static assets (Cloudflare Pages)
    // If env.ASSETS is available (e.g. in Cloudflare Pages Functions), use it to fetch static assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    // Default response for non-proxy paths
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};
