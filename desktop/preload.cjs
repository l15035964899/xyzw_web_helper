const { contextBridge, ipcRenderer } = require("electron");

try {
  if (
    location.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(location.hostname)
  ) {
    localStorage.removeItem("xyzw_nas_api_base");
    localStorage.removeItem("xyzw_nas_api_key");
  }
} catch {
  // The setup page can run before storage is ready.
}

contextBridge.exposeInMainWorld("xyzwDesktop", {
  getConfig: () => ipcRenderer.invoke("desktop:get-config"),
  testConfig: (input) => ipcRenderer.invoke("desktop:test-config", input),
  saveConfig: (input) => ipcRenderer.invoke("desktop:save-config", input),
  openApp: () => ipcRenderer.invoke("desktop:open-app"),
  getGameBin: (tokenId) => ipcRenderer.invoke("desktop:get-game-bin", tokenId),
});
