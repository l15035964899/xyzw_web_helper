# XYZW NAS Desktop

桌面控制台复用原版网页，将账号、BIN、定时任务和执行日志继续保存在 NAS。
客户端关闭后，NAS 上的定时任务不受影响。

## 模式

- 桌面端在 `127.0.0.1:47831` 提供本地静态界面。
- 所有 `/api/*` 请求由主进程转发到已配置的 NAS，并自动附加 API Key。
- API Key 使用 Electron `safeStorage` 加密，保存在系统安全存储保护的配置文件中。
- 渲染页面不接触 NAS API Key，也不会使用 `localStorage` 直连 NAS。
- 打开游戏时，主进程通过仅接受 API Key 的受限接口临时读取单个账号 BIN；
  渲染页面的本地代理不允许直接访问该接口。
- BIN 只写入当前游戏窗口的隔离存储作用域，游戏启动完成后立即删除；
  刷新游戏窗口时从内存临时重新注入。
- 页面只在本地来源运行，拒绝陌生 Host、跨站请求、路径穿越和外部导航。

## 首次使用

macOS 首次连接会询问是否允许访问“本地网络”，请选择允许。客户端的
macOS 程序 UUID 和代码签名在每次正式构建时都会固定写入，避免系统把不同
Electron 应用误认为同一个应用。

如果从旧版升级后仍然看到 `EHOSTUNREACH`，请先彻底退出旧客户端，覆盖安装
2.1.2，然后重启一次 Mac。旧系统缓存可能仍把多个 Electron 应用识别为同一个
应用；重启后再次打开客户端并允许“本地网络”访问即可。

启动后填写：

- NAS 地址，例如 `http://192.168.0.222:3002`
- NAS API Key

客户端会先通过 `/api/tokens` 验证连接并读取账号数量，验证通过后才保存配置。

## 系统行为

- 关闭窗口后隐藏到系统托盘。
- 托盘可打开主界面、修改 NAS 设置、切换开机启动或彻底退出。
- 每 30 秒检查一次 NAS 状态。
- 单实例运行，重复启动会聚焦已有窗口。
- 启用上下文隔离、沙箱和外部链接拦截。

## 数据位置

macOS：

```text
~/Library/Application Support/XYZW-NAS-Desktop
```

Windows：

```text
%APPDATA%\XYZW-NAS-Desktop
```

目录内包含加密后的 NAS 配置和启动日志。日志不记录 API Key、Token、请求正文或响应正文。

## 开发和测试

```bash
npm ci --prefix desktop
npm --prefix desktop test
node desktop/build.mjs
npm --prefix desktop run smoke
```

## 打包

```bash
node desktop/build.mjs mac
node desktop/build.mjs win
node desktop/build.mjs all
```

产物输出到 `desktop/release/`。macOS 会优先使用钥匙串中的 Apple
Development 或 Developer ID 证书签名。若没有代码签名证书，macOS 的本地网络
授权可能无法稳定保存，此时应安装签名版本。
