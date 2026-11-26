const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} = require("electron");
const { createConfigStore, normalizeBaseUrl } = require("./config.cjs");
const { fetchNasGameBin, probeNas } = require("./nas.cjs");
const { startServer } = require("./server.cjs");

const PORT = 47831;
const smoke = process.argv.includes("--desktop-smoke-test");
app.setName("XYZW NAS Desktop");
app.setPath("userData", path.join(app.getPath("appData"), "XYZW-NAS-Desktop"));

let service;
let window;
let tray;
let trayMenu;
let config;
let quitting = false;
let healthTimer;
let healthBusy = false;
let startupError = null;
let configStore;

function log(message) {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.appendFileSync(
      path.join(app.getPath("userData"), "startup.log"),
      `${new Date().toISOString()} ${message}\n`,
    );
  } catch {
    // Logging must not prevent startup.
  }
}

function setupUrl() {
  return pathToFileURL(path.join(__dirname, "setup.html")).href;
}

function isTrustedSender(event) {
  const url = event.senderFrame?.url || "";
  return (
    url === setupUrl() || Boolean(service && url.startsWith(service.origin))
  );
}

function assertTrustedSender(event) {
  if (!isTrustedSender(event)) throw new Error("Blocked desktop request");
}

function publicConfig() {
  return {
    configured: Boolean(config?.baseUrl && config?.apiKey),
    baseUrl: config?.baseUrl || "",
    hasApiKey: Boolean(config?.apiKey),
  };
}

function candidateConfig(input) {
  return {
    baseUrl: normalizeBaseUrl(input?.baseUrl || config?.baseUrl),
    apiKey: String(input?.apiKey || "").trim() || config?.apiKey || "",
  };
}

function updateTrayStatus(status, detail = "") {
  if (!tray) return;
  const label =
    status === "online"
      ? "NAS：在线"
      : status === "offline"
        ? "NAS：离线"
        : "NAS：未连接";
  tray.setToolTip(`XYZW NAS Desktop · ${label}${detail ? ` · ${detail}` : ""}`);
  if (trayMenu) {
    const item = trayMenu.getMenuItemById("status");
    if (item) item.label = label;
  }
}

async function checkNasHealth() {
  if (!config || healthBusy) return;
  healthBusy = true;
  try {
    const result = await probeNas(config);
    updateTrayStatus("online", `${result.count ?? 0} 个账号`);
  } catch (error) {
    updateTrayStatus("offline");
    log(`NAS health check failed: ${error.message}`);
  } finally {
    healthBusy = false;
  }
}

function startHealthPolling() {
  clearInterval(healthTimer);
  healthTimer = null;
  if (smoke) return;
  void checkNasHealth();
  healthTimer = setInterval(checkNasHealth, 30000);
  healthTimer.unref?.();
}

async function loadApplication() {
  if (!service || !window) return;
  if (!config) {
    await window.loadURL(setupUrl());
    window.setTitle("连接 XYZW NAS");
    updateTrayStatus("unconfigured");
    return;
  }
  await window.loadURL(`${service.origin}/`);
  window.setTitle("XYZW NAS 管理控制台");
  startHealthPolling();
}

async function showSettings() {
  if (!window) await createWindow();
  await window.loadURL(setupUrl());
  window.setTitle("连接 XYZW NAS");
  window.show();
  window.focus();
}

function showWindow() {
  if (!window) {
    createWindow()
      .then(loadApplication)
      .catch((error) => dialog.showErrorBox("XYZW", error.message));
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createApplicationMenu() {
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { label: "设置 NAS", click: showSettings },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const iconPath = path.join(__dirname, "resources", "icon.png");
  let image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) image = image.resize({ width: 18, height: 18 });
  tray = new Tray(image);
  trayMenu = Menu.buildFromTemplate([
    {
      id: "status",
      label: "NAS：未连接",
      enabled: false,
    },
    { type: "separator" },
    { label: "打开主界面", click: showWindow },
    { label: "设置 NAS", click: showSettings },
    {
      label: "开机启动",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(trayMenu);
  tray.on("click", showWindow);
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    title: "XYZW NAS 管理控制台",
    show: !smoke,
    autoHideMenuBar: true,
    backgroundColor: "#10151f",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  const isLocal = (url) => {
    try {
      return (
        url === setupUrl() ||
        Boolean(service && new URL(url).origin === service.origin)
      );
    } catch {
      return false;
    }
  };
  window.webContents.on("will-navigate", (event, url) => {
    if (!isLocal(url)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !isLocal(url)) {
      shell.openExternal(url).catch(() => log("External browser failed"));
    }
    return { action: "deny" };
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    log(`Renderer stopped: ${details.reason}`);
  });
  window.webContents.on("did-fail-load", (_event, code, description) => {
    log(`Page load failed: ${code} ${description}`);
  });
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    window = null;
  });
  return window;
}

function registerIpc() {
  ipcMain.handle("desktop:get-config", (event) => {
    assertTrustedSender(event);
    return publicConfig();
  });
  ipcMain.handle("desktop:test-config", async (event, input) => {
    assertTrustedSender(event);
    try {
      return {
        ok: true,
        ...(await probeNas(candidateConfig(input))),
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message || "NAS 连接测试失败",
      };
    }
  });
  ipcMain.handle("desktop:save-config", async (event, input) => {
    assertTrustedSender(event);
    try {
      const candidate = candidateConfig(input);
      await probeNas(candidate);
      config = await configStore.save(candidate, config);
      await loadApplication();
      updateTrayStatus("online");
      return { ok: true, config: publicConfig() };
    } catch (error) {
      return {
        ok: false,
        error: error.message || "NAS 配置保存失败",
      };
    }
  });
  ipcMain.handle("desktop:open-app", async (event) => {
    assertTrustedSender(event);
    if (!config) {
      return { ok: false, error: "请先完成 NAS 连接设置" };
    }
    await loadApplication();
    return { ok: true };
  });
  ipcMain.handle("desktop:get-game-bin", async (event, tokenId) => {
    assertTrustedSender(event);
    if (!config) {
      return { ok: false, error: "请先完成 NAS 连接设置" };
    }
    try {
      const body = await fetchNasGameBin(config, tokenId);
      return {
        ok: true,
        data: body.buffer.slice(
          body.byteOffset,
          body.byteOffset + body.byteLength,
        ),
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message || "从 NAS 读取账号 BIN 失败",
      };
    }
  });
}

async function runSmokeTest() {
  await window.loadURL(`${service.origin}/tokens`);
  const result = await window.webContents
    .executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000;
    const check = () => {
      const mounted = document.querySelector('#app')?.__vue_app__;
      if (mounted && typeof window.__require === 'function') {
        const crypto = window.__require('13');
        localStorage.setItem('__desktop_smoke', 'ok');
        resolve({
          mounted: !!mounted,
          path: location.pathname,
          crypto: typeof crypto.encMsg === 'function',
          nodeIntegration: typeof window.require,
          nasBase: localStorage.getItem('xyzw_nas_api_base'),
          nasKey: localStorage.getItem('xyzw_nas_api_key'),
        });
      } else if (Date.now() > deadline) {
        reject(new Error('Renderer readiness timed out'));
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  })`);
  console.log(`DESKTOP_SMOKE ${JSON.stringify(result)}`);
  if (
    !result.mounted ||
    !result.crypto ||
    result.path !== "/tokens" ||
    result.nodeIntegration !== "undefined" ||
    result.nasBase !== null ||
    result.nasKey !== null
  ) {
    throw new Error("Desktop smoke assertions failed");
  }
  await window.loadURL(`${service.origin}/tokens`);
  const stored = await window.webContents.executeJavaScript(
    "localStorage.getItem('__desktop_smoke')",
  );
  if (stored !== "ok") throw new Error("Desktop storage did not persist");
}

async function bootstrap() {
  const { safeStorage } = require("electron");
  configStore = createConfigStore({
    filePath: path.join(app.getPath("userData"), "desktop-config.json"),
    safeStorage,
  });
  try {
    config = await configStore.load();
  } catch (error) {
    startupError = error;
    config = null;
    log(`Config load failed: ${error.message}`);
  }

  service = await startServer({
    root: path.join(__dirname, "web"),
    port: PORT,
    getNasConfig: () => config,
    log,
  });
  registerIpc();
  createApplicationMenu();
  createTray();
  await createWindow();
  if (smoke) {
    await runSmokeTest();
    quitting = true;
    app.quit();
    return;
  }
  if (startupError) {
    dialog.showErrorBox(
      "NAS 连接配置需要更新",
      `${startupError.message}\n请重新填写 NAS 地址和 API Key。`,
    );
  }
  await loadApplication();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      log(`Startup failed: ${error.code || error.message}`);
      if (smoke) {
        console.error(`DESKTOP_SMOKE_FAILED ${error.code || error.message}`);
        app.exit(1);
        return;
      }
      const detail =
        error.code === "EADDRINUSE"
          ? `本机端口 ${PORT} 已被占用。请关闭占用程序后重试。`
          : error.message || "桌面客户端启动失败。";
      dialog.showErrorBox("XYZW 启动失败", detail);
      app.quit();
    });
  app.on("activate", showWindow);
  app.on("before-quit", (event) => {
    quitting = true;
    clearInterval(healthTimer);
    if (!service) return;
    if (service.closed) return;
    event.preventDefault();
    service.closed = true;
    service.close().then(
      () => app.quit(),
      () => app.exit(1),
    );
  });
}
