# 桌面端与 BIN 通道设计

> 状态：已实现
> 当前版本：`2.1.3`
> 目标：桌面端复用网页界面，同时安全访问 NAS

## 1. 架构

Electron 应用：

- 渲染页运行在本地 `127.0.0.1`
- `/api/*` 由主进程转发到 NAS
- API Key 由主进程持有
- 渲染页不接触 API Key
- 不通过渲染页本地代理读取游戏 BIN

## 2. NAS 配置

用户填写：

```text
NAS 地址，例如 http://192.168.0.222:3002
NAS API Key
```

API Key 使用 Electron `safeStorage` 加密保存。

连接验证：

1. 请求 `/api/tokens`
2. 检查 API Key
3. 检查账号数量
4. 成功后才保存配置

## 3. BIN 临时通道

接口：

```text
POST /api/tokens/:id/game-bin
```

安全约束：

- 只接受 API Key，不接受普通网页会话
- 不通过通用 `/api` 代理暴露给渲染页
- 设置 `Cache-Control: no-store`
- 响应无缓存
- 不把 BIN 写入用户持久文件

流程：

1. Electron 主进程通过受限 IPC 获取单账号 BIN。
2. BIN 只在当前游戏隔离作用域写入。
3. 游戏 ready 后删除 `bin_data_*`。
4. 返回、关闭、启动失败时清空作用域和内存副本。
5. 刷新 iframe 时只从内存中临时重新注入。

## 4. 游戏作用域

单账号和多账号都复用隔离的 `multi-game` 启动机制。

关键键：

```text
multi-game_active_launch_v1
single-game_active_launch_v1
multi-game:<scope>:...
multi-game:<scope>:bin_data_<tokenId>
```

`scopeId` 必须随机生成，不能直接使用账号或角色 ID。

## 5. 代码位置

```text
desktop/main.cjs
desktop/server.cjs
desktop/nas.cjs
desktop/config.cjs
desktop/preload.cjs
desktop/setup.html
src/utils/gameLauncher.js
src/views/Dashboard.vue
src/views/GamePlayer.vue
src/views/GameMultiPlayer.vue
src/views/TokenImport/TokenImport.vue
render-backend/server.js
```

测试：

```text
desktop/test/*.test.cjs
test/gameLauncher.test.js
```

## 6. 构建

```bash
npm ci --prefix desktop
npm test --prefix desktop
node desktop/build.mjs mac
node desktop/build.mjs win
node desktop/build.mjs all
```

产物：

```text
desktop/release/
```

macOS 需要本地网络权限。正式版本应使用固定 UUID 和代码签名。

## 7. 禁止事项

- 不让 API Key 进入渲染进程。
- 不把完整 BIN写入日志、错误响应或持久缓存。
- 不新增渲染页可直接读取 BIN 的本地接口。
- 不和网页端同时控制同一游戏账号。
- 不在构建测试并行时运行网页 build，避免 `dist` 快照竞争。
