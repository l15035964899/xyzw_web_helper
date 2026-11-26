/* eslint-disable no-template-curly-in-string */
module.exports = {
  appId: "com.xyzw.nasdesktop",
  productName: "XYZW NAS Desktop",
  afterPack: "scripts/patch-electron-uuid.cjs",
  directories: {
    output: "release",
    buildResources: "resources",
  },
  files: [
    "main.cjs",
    "preload.cjs",
    "config.cjs",
    "nas.cjs",
    "server.cjs",
    "setup.html",
    "resources/icon.png",
    "web/**/*",
    "package.json",
  ],
  asar: true,
  npmRebuild: false,
  artifactName: "XYZW-NAS-Desktop-${version}-${os}-${arch}.${ext}",
  mac: {
    target: ["dmg"],
    category: "public.app-category.games",
    icon: "resources/icon.png",
    identity: process.env.CSC_NAME || undefined,
    extendInfo: {
      NSLocalNetworkUsageDescription:
        "用于连接您配置的 XYZW NAS，读取账号、定时任务和执行日志。",
    },
  },
  win: {
    target: ["nsis"],
    icon: "resources/icon.png",
  },
  nsis: {
    artifactName: "XYZW-NAS-Desktop-${version}-windows-setup.${ext}",
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    installerLanguages: ["zh_CN", "en_US"],
    shortcutName: "XYZW NAS Desktop",
  },
};
