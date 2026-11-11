const API_BASE_KEY = "xyzw_nas_api_base";
const API_KEY_KEY = "xyzw_nas_api_key";

export function loadServerConnection() {
  return {
    baseUrl: localStorage.getItem(API_BASE_KEY) || "",
    apiKey: localStorage.getItem(API_KEY_KEY) || "",
  };
}

export function saveServerConnection({ baseUrl = "", apiKey = "" }) {
  localStorage.setItem(API_BASE_KEY, String(baseUrl).trim());
  localStorage.setItem(API_KEY_KEY, String(apiKey).trim());
}

export async function serverRequest(
  path,
  { baseUrl = "", apiKey = "", method = "GET", body } = {},
) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (String(apiKey).trim()) headers["x-api-key"] = String(apiKey).trim();

  const base = String(baseUrl).trim().replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    throw new Error(
      `${response.status} ${data?.error || data?.message || response.statusText}`,
    );
  }
  return data;
}
