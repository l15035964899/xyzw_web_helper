const { Buffer } = require("node:buffer");
const fs = require("node:fs/promises");
const path = require("node:path");
const process = require("node:process");

function normalizeBaseUrl(value) {
  const input = String(value || "").trim();
  if (!input) throw new Error("请输入 NAS 地址");
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("NAS 地址格式无效");
  }
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

function normalizeApiKey(value) {
  const apiKey = String(value || "").trim();
  if (!apiKey) throw new Error("请输入 NAS API Key");
  return apiKey;
}

function createConfigStore({ filePath, safeStorage }) {
  async function load() {
    let data;
    try {
      data = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw new Error("桌面端 NAS 配置读取失败");
    }
    if (data?.version !== 1 || !data.baseUrl || !data.encryptedApiKey) {
      throw new Error("桌面端 NAS 配置不完整，请重新设置");
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("系统安全存储不可用，无法读取 NAS API Key");
    }
    try {
      const apiKey = safeStorage.decryptString(
        Buffer.from(data.encryptedApiKey, "base64"),
      );
      return {
        baseUrl: normalizeBaseUrl(data.baseUrl),
        apiKey: normalizeApiKey(apiKey),
      };
    } catch {
      throw new Error("NAS API Key 解密失败，请重新设置");
    }
  }

  async function save(input, existing = null) {
    const baseUrl = normalizeBaseUrl(input?.baseUrl);
    const candidate = String(input?.apiKey || "").trim();
    const apiKey = candidate || existing?.apiKey;
    if (!apiKey) throw new Error("请输入 NAS API Key");
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("系统安全存储不可用，无法保存 NAS API Key");
    }
    const encryptedApiKey = safeStorage
      .encryptString(apiKey)
      .toString("base64");
    const payload = {
      version: 1,
      baseUrl,
      encryptedApiKey,
      updatedAt: new Date().toISOString(),
    };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
      mode: 0o600,
    });
    await fs.rename(temporary, filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
    return { baseUrl, apiKey };
  }

  function summary(config) {
    return {
      configured: Boolean(config?.baseUrl && config?.apiKey),
      baseUrl: config?.baseUrl || "",
      hasApiKey: Boolean(config?.apiKey),
    };
  }

  return { load, save, summary };
}

module.exports = {
  createConfigStore,
  normalizeApiKey,
  normalizeBaseUrl,
};
