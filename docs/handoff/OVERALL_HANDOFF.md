# XYZW NAS 自动化整体交接方案

> 更新时间：2026-11-26 CST
> 适用对象：第一次接手本项目的开发者或新会话
> 当前分支：`main`
> 当前 HEAD：`0de6c60`
> 当前 Fork：`git@github.com:l15035964899/xyzw_web_helper.git`

## 0. 文档定位

本文件只负责全局交接：当前状态、架构、代码入口、开发规则、提交策略和部署流程。
具体功能规则拆到 `requirements/`，每做一个需求只需更新对应文档，避免总文档持续膨胀。

阅读顺序：

1. 先读本文件。
2. 按任务选择一份需求文档。
3. 再检查当前源码、运行状态和 Git 状态。

不要要求用户重复解释历史背景，不要重新输出项目分析报告。

## 1. 当前状态快照

| 项目 | 2026-11-26 状态 |
| --- | --- |
| NAS | `192.168.0.222:3002` |
| 容器 | `xyzw-nas-all`，`running / healthy` |
| 镜像 | `ghcr.io/l15035964899/xyzw-nas-all:fd8241c-nightmare31` |
| 存储 | `STORE_MODE=local` |
| 健康接口 | `status=ok`、`activeCrons=11` |
| NAS 账号 | 12 个，全部启用 |
| 角色身份 | 12/12 已验证，0 个身份错误 |
| NAS 任务 | 14 个，其中 11 个启用 |
| 十殿任务 | 当前没有运行中的队伍 |
| 抢符任务 | 每日 `59 11 * * *`，3 个账号，任务内等待 12:00 |
| Web/服务端测试 | 280 项通过 |
| 桌面端测试 | 17 项通过 |
| 桌面端版本 | `2.1.3` |

数量与任务配置是快照。用户会持续修改，写入前必须重新读取 NAS API。

## 2. Fork 与提交策略

```text
origin（源仓库）：
https://github.com/w1249178256/xyzw_web_helper.git

fork（个人 Fork）：
git@github.com:l15035964899/xyzw_web_helper.git
```

规则：

- Fork 只有用户一人开发。
- 长期只维护 `main`，不创建普通功能分支，不要求 PR。
- 以后直接提交到本地 `main`，通过 `git push fork main` 更新远端。
- 不推送到 `origin/main`。
- 没有用户明确的“提交”或“推送”指令时，只修改和验证。
- Commit 使用中文标题和说明。
- 尽量按功能拆分 commit；共享文件可合理使用 hunk 级拆分。
- 不使用无信息的 `git add .`。
- 不删除或改写远端历史，除非用户明确要求。

当前远端状态：

```text
fork/main = 0de6c60
origin/main = cf45acf
```

## 3. 需求文档索引

| 功能 | 文档 | 当前状态 |
| --- | --- | --- |
| 自动十殿 | [auto-nightmare.md](requirements/auto-nightmare.md) | 已实现并真实通关 |
| 周常礼包与日志 | [weekly-gifts-and-logs.md](requirements/weekly-gifts-and-logs.md) | 招募周完成，另外两种周常待补 |
| NAS 调度与任务运行 | [nas-batch-runtime.md](requirements/nas-batch-runtime.md) | 已实现 |
| 角色身份与 Token | [role-identity-and-token.md](requirements/role-identity-and-token.md) | 已实现并在线验证 |
| 桌面端与 BIN | [desktop-client-and-bin.md](requirements/desktop-client-and-bin.md) | 已实现 |
| 日常任务可靠性 | [daily-task-reliability.md](requirements/daily-task-reliability.md) | 已实现主要修复 |
| 后续路线 | [future-roadmap.md](requirements/future-roadmap.md) | 未实现需求集中记录 |

需求目录另有 [索引](requirements/README.md)。

## 4. 项目运行架构

单容器 `xyzw-nas-all`：

- Express 托管 Vue 构建产物和 `/api`。
- Node 进程负责游戏 WebSocket、Cron、账号锁、任务执行、十殿和日志。
- NAS 本地 JSON/JSONL 是权威数据源。
- 容器端口 `3002:3000`，重启策略 `unless-stopped`。
- 唯一自动调度源是 NAS `node-cron`。

主要持久文件：

```text
/volume1/docker/xyzw-nas-all/data/tokens.json
/volume1/docker/xyzw-nas-all/data/cron-tasks.json
/volume1/docker/xyzw-nas-all/data/batch-settings.json
/volume1/docker/xyzw-nas-all/data/task-logs.jsonl
/volume1/docker/xyzw-nas-all/data/token-refresh-credentials.json
/volume1/docker/xyzw-nas-all/data/nightmare-runs.json
```

Cloudflare、Render、Supabase 暂不是运行依赖。没有明确授权，不删除这些云端资源，
也不要把主运行链路迁回去。

## 5. 代码导航

| 模块 | 主要文件 | 用途 |
| --- | --- | --- |
| 前端路由与布局 | `src/router/index.js`、`src/layout/DefaultLayout.vue` | 页面、菜单、主题 |
| 批量日常 UI | `src/views/BatchDailyTasks.vue` | 任务、日志、十殿配置入口 |
| 批量任务定义 | `src/utils/batch/constants.js`、`tasksStore.js` | 任务目录和浏览器任务 |
| NAS API 客户端 | `src/api/*.js` | 前端调用后端 |
| 游戏前端协议 | `src/utils/xyzwWebSocket.js`、`gameCommands.js` | 前端命令注册 |
| NAS 主服务 | `render-backend/server.js` | API、Cron、队列、任务编排和十殿接口 |
| NAS 游戏连接 | `render-backend/lib/gameClient.js` | Backend WebSocket 和协议映射 |
| 原生任务 | `render-backend/lib/nativeBatchTasks.js` | 单账号定时任务 |
| 调度状态 | `render-backend/lib/dailyTaskRunner.js`、`dailyTaskState.js` | 每日任务执行与官方配置 |
| 重试 | `render-backend/lib/taskRetry.js` | 安全重试与延期续跑 |
| 账号锁 | `render-backend/lib/tokenLockQueue.js`、`manualLeaseManager.js` | FIFO 锁与手动租约 |
| Token | `render-backend/lib/tokenRefresh.js` | BIN 换 Token |
| 角色身份 | `render-backend/lib/roleIdentity.js`、`src/utils/roleIdentity.js` | 防串号 |
| 存储 | `render-backend/lib/dataStore.js`、`localStore.js` | NAS 本地/Supabase 适配 |
| 日志 | `render-backend/lib/logSanitizer.js`、`logRetention.js`、`taskLogDescriptions.js` | 脱敏、保留和中文描述 |
| 桌面端 | `desktop/` | Electron、本地代理和临时 BIN |
| 十殿核心 | `render-backend/lib/nightmareRunner.js`、`nightmareSettings.js` | 建队、挑战、跨周、符咒 |
| 十殿 UI | `src/components/Nightmare/NightmareConfigModal.vue` | 队伍和出战顺序配置 |
| 测试 | `test/*.test.js`、`desktop/test/*.test.cjs` | 服务端、前端和桌面端验证 |

## 6. 开发前检查

1. 执行 `git status -sb`。
2. 检查 `git log -5 --oneline` 和当前分支。
3. 只读检查：

```bash
curl -fsS http://192.168.0.222:3002/health
```

4. 涉及任务和账号时检查：

```text
GET /api/tasks/runtime
GET /api/batch-settings
GET /api/tasks
GET /api/tokens
```

5. 涉及十殿时额外检查：

```text
GET /api/nightmare/status
GET /api/nightmare/teams/:id/status?refresh=1
```

6. 修改前确认没有真实任务正在使用目标账号。

## 7. 通用代码修改入口

### 新增批量任务

1. `src/utils/batch/constants.js`
2. `render-backend/lib/nativeBatchTasks.js`
3. `render-backend/server.js`（需要跨账号编排时）
4. `src/views/BatchDailyTasks.vue`
5. `render-backend/lib/taskLogDescriptions.js`
6. `src/utils/serverTaskLog.js`
7. 对应测试

### 新增游戏命令

1. 后端 `render-backend/lib/gameClient.js`
2. 浏览器端需要时同步 `src/utils/xyzwWebSocket.js`
3. 日志描述
4. 协议结构测试

### 新增账号字段

1. `render-backend/lib/dataStore.js`
2. `render-backend/lib/localStore.js`
3. `render-backend/server.js`
4. `src/stores/tokenStore.ts`
5. `src/utils/serverTokenSync.js`
6. 同步与身份测试

## 8. 安全规则

1. 不输出密码、API Key、Token、`roleToken`、`sessId`、`connId`、完整 BIN。
2. 不打印 NAS Compose 全文。
3. 同一角色通常只允许一个在线会话。
4. 没有明确要求，不触发真实十殿挑战，避免消耗门票和符咒。
5. 十殿房间操作只由队长连接发送。
6. 无法确认解散时保留现场，不能盲目退出或恢复阵容。
7. 可预期业务状态按警告处理，不能全部当作系统故障。
8. 用户描述的现场行为优先于代码猜测，修改前用只读状态或实验验证。

## 9. 验证与部署

### 修改后

```bash
node --test test/*.test.js
npm test --prefix desktop
./node_modules/.bin/eslint src render-backend test \
  public/game/multi-game-storage-bridge.js \
  public/game/diagnose_require.js \
  vite.config.js worker.js eslint.config.mjs uno.config.ts \
  --max-warnings 0
./node_modules/.bin/vite build
git diff --check
```

桌面端构建隔离测试不要和 `npm run build` 并行执行，因为两者都会读取/改写 `dist`。

### 构建 NAS 镜像

NAS 是 x86_64：

```bash
SHA=$(git rev-parse --short HEAD)
IMAGE="ghcr.io/l15035964899/xyzw-nas-all:${SHA}-label"

docker buildx build \
  --platform linux/amd64 \
  --pull=false \
  --load \
  -t "$IMAGE" \
  -f Dockerfile.nas-all .
```

### 导入与替换

```bash
{
  security find-internet-password \
    -s 'Home_NAS._smb._tcp.local' \
    -a lolly -w 2>/dev/null
  docker save "$IMAGE"
} | ssh nas-lolly "sudo -S -p '' /usr/local/bin/docker load"
```

先备份 NAS Compose，再修改 image 标签并重建：

```bash
security find-internet-password \
  -s 'Home_NAS._smb._tcp.local' \
  -a lolly -w 2>/dev/null |
ssh nas-lolly "cd /volume1/docker/xyzw-nas-all && \
  sudo -S -p '' /usr/local/bin/docker compose -f compose.yaml up -d"
```

禁止输出 Compose 内容。

### 部署后

- `/health` 为 `ok`
- `storage=local`
- `activeCrons` 与启用任务数一致
- 容器健康且 RestartCount 合理
- 页面 bundle 已刷新
- 目标任务没有意外运行中

## 10. 日志与排障

常用接口：

```text
GET /api/logs/db?limit=100
GET /api/logs/db?status=error&limit=5000
GET /api/logs/db?run_id=<run-id>
GET /api/logs/db?task_id=<task-id>
GET /api/logs?limit=200
GET /api/tasks/runtime
```

常见错误：

| 错误/状态 | 含义 | 处理 |
| --- | --- | --- |
| `1006` | WebSocket 异常关闭 | 检查双端登录、Token、租约 |
| `未连接` | 命令发送前连接已断 | 先重连，不盲目整任务重跑 |
| `200750` | 战斗版本失效 | 已动态读取 `battleVersion` |
| `400122` | 开箱数量/库存被拒绝 | 保留待完成，不更换箱子规避 |
| `1100010` | 本周限购已领取 | 招募周场景按警告 |
| `200020` | 游戏临时异常 | 只有明确证明已领取的场景才降级 |

真实任务调试原则：

- 先读日志、房间快照和角色状态。
- 只读探测可以直接做。
- 有门票、购买、赠送、战斗副作用时，必须获得明确授权。
- 中途异常先保留现场，不要因第一个错误直接退出挑战。

## 11. 已知风险

1. 三套十殿未来可能共享一个主力，目前尚不允许跨队重复账号。
2. `nightmare-runs.json` 已持久化跨周状态，但运行中队列和缓存仍需通过 API 核实。
3. 同一账号只能一个会话在线，共享主力后必须串行执行。
4. `nightmareRunner.js` 较大，新增复杂逻辑前先补测试。
5. NAS 镜像是本地导入，不一定已上传 GHCR。
6. 游戏活动规则和错误码可能变化，以实机返回为准。
7. 周常限时商店只有招募周完成，宝箱周和黑市周仍待补。
8. Fork 上仍存在历史分支 `codex/v3-refactor`，本次未删除。

## 12. 最终检查清单

```text
[ ] 已读取总交接和对应需求文档
[ ] 已检查 Git 状态与当前分支 main
[ ] 没有覆盖用户未提交修改
[ ] 没有触发未授权的真实游戏操作
[ ] /health、任务和账号状态正常
[ ] 目标测试、全量测试、桌面测试、构建通过
[ ] 提交信息为中文并按功能拆分
[ ] 推送目标是 fork/main
[ ] 没有输出敏感值
[ ] 已更新对应需求文档，而不是继续膨胀总文档
```
