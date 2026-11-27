# NAS 原生自动推图设计

> 状态：已实现并部署，单账号在线运行通过；关闭浏览器和重启恢复待专项验收
> 当前镜像：`ghcr.io/l15035964899/xyzw-nas-all:05b2ab6-nas-pushing-20261127-r1`
> 目标：浏览器关闭后，由 NAS 持续自动推主线关卡
> 相关 PR：https://github.com/w1249178256/xyzw_web_helper/pull/445

## 1. 背景与结论

PR #445 通过模块级状态、Web Worker 节拍器和静默音频，解决浏览器站内切页后推图停止的问题。但它仍然依赖浏览器页面：

- 关闭标签页后停止。
- 页面刷新后停止。
- 浏览器或设备休眠后可能停止。
- 无法与 NAS 定时任务、账号锁和持久化状态统一协调。

因此，浏览器关闭后仍要持续推图，必须将推图循环迁移到 NAS 后端。

本项目已有可直接复用的基础设施：

- `render-backend/lib/gameClient.js`
- `render-backend/lib/tokenLockQueue.js`
- `render-backend/lib/tokenRefresh.js`
- `render-backend/lib/roleIdentity.js`
- `render-backend/lib/dataStore.js`
- `render-backend/lib/localStore.js`
- NAS Cron 和任务日志

## 2. 目标

- 改造现有“主线推关”页面，在页面内启动 NAS 原生推图。
- 启动后关闭浏览器，推图继续运行。
- NAS 容器重启后恢复未停止的推图会话。
- 每个账号独立战斗，支持多账号并发上限。
- 使用 Token 自动刷新和真实角色身份校验。
- 与现有 NAS 定时任务共用账号锁。
- 自动推图遇到定时任务时在安全边界暂停整个会话并释放锁。
- 通过网页查看实时状态、关卡、胜负、倒计时和错误。
- 可以安全停止、暂停和恢复。
- 不重复结算、不因超时盲目重放写操作。

## 3. 非目标

- 第一版不替代浏览器内保留的旧推图模式。
- 第一版不自动抓取 BIN 或修改 Token。
- 第一版不支持浏览器完全退出后从浏览器继续控制已有 WebSocket。
- 第一版不自动判断阵容强度或更换阵容。
- 第一版不主动使用火把、金砖或其他消耗品。
- 第一版不根据月赛、竞技场等活动自动切换任务。

## 4. 总体架构

```text
现有“主线推关”页面
src/views/PushingLevels.vue
  │
  ├─ POST /api/pushing/runs       启动 NAS 推图
  ├─ GET  /api/pushing/status     轮询状态
  ├─ POST /api/pushing/runs/:id/stop  停止或暂停
  │
  ▼
Express API
  │
  ▼
PushSessionManager
  ├─ PushRunner（单账号状态机）
  ├─ TokenLockQueue
  ├─ TokenRefreshManager
  ├─ GameClient
  ├─ TaskLogs
  └─ pushing-runs.json
```

NAS 进程是唯一执行者。浏览器关闭不会影响 `PushSessionManager`。

## 5. 运行模式

第一版只支持手动启动和手动停止。

用户在现有“主线推关”页面选择账号并点击“NAS 自动推图”。

规则：

- 不设置最大运行时长，持续运行到用户手动停止。
- 关闭浏览器不影响执行。
- 页面重新打开后读取 NAS 当前状态。
- 第一版不提供定时启动推图。
- 第一版不提供从任务列表自动启动推图。
- 默认使用 NAS 模式，页面保留“浏览器 / NAS”切换。

## 6. 定时任务暂停与恢复策略

自动推图会长期持有账号连接，不能简单无限占锁，否则每日 00:05、06:10 等任务会被长期阻塞。

确认规则：只要自动任务需要占用推图中的任一账号，就暂停整个推图会话。

1. 推图持有账号锁并执行当前战斗。
2. 普通 NAS 定时任务尝试获取任一推图账号时，在锁队列中标记等待。
3. 整个推图会话进入 `waiting-scheduled-task`，所有账号不再开始下一场。
4. 已在进行的战斗正常完成结算。
5. 所有推图账号断开游戏连接，释放全部账号锁。
6. 定时任务按现有 FIFO 规则执行。
7. 等当前等待的定时任务全部结束后，推图会话重新获取全部账号锁并恢复。
8. 恢复连接前重新检查 Token 和真实角色身份。

必须等当前战斗结算后再断开，不能在 `fight_calcleveltime` 和 `fight_level` 之间直接释放锁。

如果定时任务触发失败重试，推图恢复后会再次遇到该任务，并重新进入暂停流程。定时任务的优先级高于持续推图。

### 6.1 TokenLockQueue 扩展

新增能力：

```text
hasWaitingTask(tokenId)
waitingTaskIds(tokenId)
onAvailabilityChange(callback)
```

`PushSessionManager` 在以下安全点检查等待者：

- `fight_level` 完成后。
- 战斗失败重试等待前。
- 任务暂停或重连前。

## 7. 数据模型

新增权威文件：

```text
/data/pushing-runs.json
```

文件不保存 Token、BIN、`roleToken`、`sessId` 或 `connId`。

### 7.1 会话状态

```text
{
  version: 1,
  runId: "uuid",
  taskId: "pushing-uuid",
  status: "queued|running|waiting-scheduled-task|waiting-relogin|paused|stopping|stopped|failed",
  requestedBy: "nas-manual",
  createdAt: "ISO",
  startedAt: "ISO",
  stoppedAt: "ISO|null",
  stopReason: "",
  stopRequested: false,
  options: {
    maxConcurrent: 1,
    maxRetries: 999999,
    retryDelaySeconds: 3,
    battleIntervalSeconds: 2,
    battleTimeCapSeconds: 1800,
    autoContinue: true,
    autoUpgradeHangup: true,
    kickReloginDelayMinutes: 5
  },
  tokenIds: [],
  accounts: {},
  updatedAt: "ISO"
}
```

### 7.2 单账号状态

```text
{
  tokenId,
  tokenName,
  status: "queued|connecting|idle|calculating|fighting|settling|waiting|waiting-scheduled-task|waiting-relogin|paused|stopped|failed",
  level: 0,
  bossName: "",
  battleVersion: null,
  battleTime: 0,
  battleStartedAt: null,
  lastSettlementAt: null,
  battles: 0,
  wins: 0,
  losses: 0,
  retries: 0,
  consecutiveErrors: 0,
  lastError: "",
  torchType: 0,
  torchRemaining: 0,
  torchSettleTime: 0,
  kickedAt: null,
  reloginAt: null,
  kickCount: 0,
  lastHeartbeatAt: null,
  updatedAt: "ISO"
}
```

### 7.3 持久化频率

- 状态迁移时立即保存。
- 战斗倒计时不需要每秒写文件。
- 运行中最多每 5 秒保存一次轻量状态。
- 停止、失败、结算和容器启动恢复前必须强制保存。

## 8. 后端模块

当前新增：

```text
render-backend/lib/pushRunner.js
render-backend/lib/pushSessionManager.js
render-backend/lib/pushState.js
```

职责：

| 模块 | 职责 |
| --- | --- |
| `pushState.js` | 状态规范化、迁移、持久化和日志安全 |
| `pushRunner.js` | 单账号连接、战斗、重试和停止 |
| `pushSessionManager.js` | 多账号调度、锁队列、启动/停止和恢复 |

修改：

```text
render-backend/server.js
render-backend/lib/gameClient.js
render-backend/lib/tokenLockQueue.js
render-backend/lib/localStore.js
render-backend/lib/dataStore.js
render-backend/lib/taskLogDescriptions.js
```

## 9. GameClient 协议补齐

浏览器推图使用：

```text
role_getroleinfo
fight_startlevel
fight_calcleveltime
fight_level
system_hangupupgrade
heart_beat
```

NAS 需要补充 `GameClient` 默认参数和旧响应映射：

```text
fight_calcleveltime: {}
fight_calcleveltimeresp -> fight_calcleveltime
fight_levelresp          -> fight_level
system_hangupupgraderesp -> system_hangupupgrade
```

实际实现必须以协议测试为准，不能凭猜测覆盖现有字段。

`fight_level` 属于 `BATTLE_VERSION_COMMANDS`，由 `GameClient` 自动读取并注入当前 `battleVersion`。遇到 `200750` 时清空缓存版本并重新读取。

## 10. 单账号状态机

```text
queued
  ↓
connecting
  ↓
idle
  ↓
calculating
  ↓
fighting
  ↓
settling
  ├─ 胜利 → idle
  ├─ 失败 → waiting → calculating
  ├─ 定时任务触发 → waiting-scheduled-task → queued
  ├─ 被顶号 → waiting-relogin → queued
  └─ 无法恢复 → paused / failed
```

### 10.1 启动

1. 获取账号锁。
2. 刷新到期 Token。
3. 连接游戏 WebSocket。
4. 读取 `role_getroleinfo`。
5. 校验真实角色身份。
6. 调用 `fight_startlevel` 获取当前关卡和战斗版本。
7. 查询关卡、BOSS 和火把状态。
8. 进入战斗循环。

Token 刷新必须发生在账号锁获取之后，沿用现有 NAS 规则。

### 10.2 单场战斗

```text
fight_calcleveltime
  → battleTime
  → 等待 battleTime
  → fight_level
  → 读取 success/isWin 和下一关
  → 保存状态
```

规则：

- `battleTime <= 0` 不进入结算，记录 warning 后重试。
- `battleTime` 超过上限时拒绝执行，避免计时异常占用数小时。
- 等待期间由 `GameClient` 自动发送心跳。
- 等待使用 NAS 进程内单调计时，不依赖浏览器。
- 每场之间默认等待 2 秒。
- 单账号串行执行，不能并发发送两场推图命令。

### 10.3 每 100 关升级挂机

浏览器当前在特定关卡自动调用：

```text
system_hangupupgrade
```

该功能会消耗知识币，NAS 端必须提供配置：

```text
autoUpgradeHangup: true|false
```

默认建议 `true`，保持现有浏览器行为，但启动确认框必须说明会消耗知识币。

### 10.4 火把

火把只由用户手动设置和使用，NAS 推图不会自动消耗火把。

页面保留：

```text
torchItemId: 1008
torchQuantity: 1
```

用户手动点击“使用火把”时：

1. 如果目标账号正在 NAS 推图，会话在安全边界暂停该账号。
2. 获取账号锁。
3. 调用 `item_consume`。
4. 重新读取 `role_getroleinfo`，确认火把类型和剩余时间。
5. 断开操作连接。
6. 如果推图会话之前仍在运行，自动重新连接并继续。

手动火把操作不会修改推图会话的长期配置。

## 11. 战斗结算可靠性

`fight_level` 是写操作，超时后不能直接重复发送，否则可能造成重复结算或状态误判。

### 11.1 结算成功

满足以下任一条件：

- 响应 `success=true`。
- 响应 `isWin=true`。
- 后续角色关卡高于战斗前关卡。

### 11.2 明确失败

- 响应字段明确为失败。
- 角色仍停留在原关卡且服务器返回业务失败码。

处理：

- 增加败场和连续失败数。
- 未达到上限时等待后继续。
- 达到上限时暂停账号，不删除运行状态。

### 11.3 结算超时或结果未知

1. 不立即重发 `fight_level`。
2. 等待 2～5 秒。
3. 读取 `role_getroleinfo` 和当前关卡。
4. 关卡增加：按胜利处理。
5. 关卡不变：标记 `settlement-unknown`，再等待后读取一次。
6. 连续判定未知达到 3 次：暂停账号并要求人工确认。

禁止把“请求超时”直接当作挑战失败并重复结算。

## 12. 连接与 Token 恢复

### 12.1 连接断开

- 暂停当前账号循环。
- 最多重连 5 次。
- 退避间隔：3、5、10、20、30 秒。
- 每次重连后重新校验真实角色。
- 重连失败时账号进入 `paused`，会话继续保留。

### 12.2 Token 临近过期

- 每次新建连接前检查 Token 年龄。
- 超过约 20 小时使用 BIN 自动刷新。
- BIN 刷新后再次读取真实角色。
- 缺少 BIN 时暂停该账号，错误为“缺少 BIN 自动刷新凭据”。

### 12.3 战斗版本失效

遇到 `200750`：

- 清空 `GameClient.battleVersion`。
- 调用 `fight_startlevel` 重新获取版本。
- 同一场最多重试一次结算。
- 再次失败则暂停账号。

### 12.4 被顶号后的重新登录

每个推图会话可配置：

```text
kickReloginDelayMinutes: 5
```

范围 `0～120` 分钟，默认建议 5 分钟。`0` 表示立即重登，但必须等待账号锁可用。

识别被顶号的可信信号：

- 服务端返回 `200760`。
- 登录后短时间内连接被关闭，且旧 Token 重新连接仍失败。
- 服务端明确提示账号在其他位置登录。
- Token 校验后角色仍一致，但连接持续被关闭。

处理流程：

1. 当前战斗不再开始下一场。
2. 如果战斗已进入结算阶段，先尝试完成或确认结算。
3. 立即断开连接，释放账号锁。
4. 账号和会话进入 `waiting-relogin`。
5. 记录 `kickedAt`，计算 `reloginAt = kickedAt + 配置延迟`。
6. 延迟期间允许 NAS 定时任务执行。
7. 到达 `reloginAt` 后重新获取账号锁、刷新 Token、登录并校验角色。
8. 恢复成功后继续推图。
9. 再次被顶号时重复该流程，并增加 `kickCount`。

被顶号不能按普通网络断线立即重连，否则可能和其他登录端反复互踢。

## 13. 多账号并发

配置：

```text
maxConcurrent
```

默认 `5`，最大限制为 `5`，用户可以下调。

规则：

- 不同账号可并行。
- 同一账号只能一个 Runner。
- 启动账号之间错开 2 秒。
- 账号数多于并发数时按每账号最多 5 场的轮转分片调度，避免后续账号长期得不到执行。
- 任一账号异常不停止其他独立账号。
- 只有所有账号都进入 stopped 或 failed 时会话结束；正常推图不会自行“完成”。

## 14. 停止与暂停

### 14.1 强制停止

- 设置 `stopRequested=true`。
- 立即中断战斗等待并断开全部游戏连接。
- 立即释放全部 NAS 账号锁。
- 如果停止发生在结算前，当前战斗标记为结果未知，不补发 `fight_level`。
- 不等待当前战斗完成。

### 14.2 暂停

以下情况使用 paused：

- 连续未知结算。
- 身份校验失败。
- Token/BIN 无法修复。
- 连接重试耗尽。
- 单账号连续失败达到上限。

暂停不删除状态，可从最后确认关卡继续。
当前页面只提供会话级强制停止，没有独立的单账号暂停按钮。

### 14.3 定时任务自动暂停

- 定时任务等待者出现后，所有账号在安全边界停止推图并释放锁。
- 会话状态为 `waiting-scheduled-task`，不是用户停止。
- 当前等待的定时任务全部结束后自动恢复，不需要用户再次点击开始。
- 浏览器关闭不影响该暂停和恢复流程。

## 15. 容器重启恢复

NAS 启动顺序：

1. 初始化 dataStore。
2. 恢复十殿等原有调度状态。
3. 加载 `pushing-runs.json`。
4. 启动 `PushSessionManager` 并自动恢复所有未停止会话。
5. 注册 Cron。

恢复规则：

- `stopRequested=true` 的会话标记为 stopped，不恢复。
- `running/queued/idle/calc/fight` 会话改为 `needs-reconcile`。
- `waiting-scheduled-task` 保留等待标记，检查锁队列后恢复。
- `waiting-relogin` 按持久化的 `reloginAt` 继续等待。
- 重新获取锁和 Token 后读取真实关卡。
- 不直接根据本地保存的倒计时结算。
- 容器重启时若原战斗已结束，按实际关卡校正胜场。
- 结果无法确认时进入 paused，不盲目发送结算。
- 处理 SIGTERM/SIGINT 时先强制保存推图状态，再退出进程。

## 16. API 设计

### 16.1 启动

```text
POST /api/pushing/runs
```

请求：

```json
{
  "token_ids": ["..."],
  "options": {
    "maxConcurrent": 1,
    "maxRetries": 999999,
    "autoContinue": true,
    "autoUpgradeHangup": true,
    "kickReloginDelayMinutes": 5
  }
}
```

响应：

```json
{
  "runId": "...",
  "status": "queued"
}
```

### 16.2 状态

```text
GET /api/pushing/status
GET /api/pushing/runs/:id
```

返回会话、账号、关卡、胜负、倒计时和锁等待状态。

### 16.3 停止

```text
POST /api/pushing/runs/:id/stop
```

请求：

```json
{
  "reason": "用户手动停止"
}
```

当前版本只有强制停止，不提供优雅等待模式。

### 16.4 暂停和恢复

```text
POST /api/pushing/runs/:id/pause
POST /api/pushing/runs/:id/resume
```

当前版本没有独立的暂停/恢复 API。定时任务、火把和异常恢复由
`PushSessionManager` 自动管理；人工干预只提供强制停止。

### 16.5 手动使用火把

```text
POST /api/pushing/runs/:id/use-torch
```

请求：

```json
{
  "token_ids": ["..."],
  "item_id": 1008,
  "quantity": 1
}
```

服务端在安全边界暂停受影响账号，使用火把后恢复原推图状态。

### 16.6 日志

复用：

```text
GET /api/logs/db?run_id=<push-run-id>
```

日志任务类型使用：

```text
pushingSession
pushingAccount
pushingBattle
pushingSettlement
pushingLock
```

## 17. 主线推关页面改造

改造现有页面，不新增批量日常入口：

```text
路由：/admin/PushingLevels
文件：src/views/PushingLevels.vue
标题：战斗推关
```

### 17.1 页面职责

页面从“浏览器推图执行器”改为“NAS 推图控制台”：

- 选择账号或分组。
- 启动 NAS 推图会话。
- 强制停止整个会话；单账号暂停由错误状态自动产生。
- 显示 NAS 实时推图状态。
- 显示 NAS 推图日志。
- 手动使用火把。
- 查看定时任务暂停和恢复状态。
- 查看被顶号后的下次重登时间。

浏览器关闭后，NAS 会话继续。重新进入页面时通过状态 API 恢复显示。

### 17.2 运行模式

页面增加：

```text
运行位置：浏览器 / NAS
```

默认选择 NAS。

- 浏览器模式保留现有逻辑，作为调试或临时使用。
- NAS 模式调用后端推图 API。
- 同一账号存在 NAS 推图会话时，禁止再启动浏览器模式。
- 第一版可以把浏览器模式放到“高级选项”中，避免误用。

### 17.3 页面结构

保留现有布局：

1. 顶部标题、自动继续和最大重试。
2. 上方账号选择列表。
3. 火把配置和控制按钮。
4. 推图状态卡片。
5. 推图日志。

改造后控件：

- 运行位置：浏览器 / NAS。
- 最大并发。
- 自动继续。
- 每 100 关自动升级挂机，默认开启。
- 被顶号后重新登录延迟，默认 5 分钟。
- 火把类型。
- 火把数量。
- 手动“使用火把”。
- 启动 NAS 推图。
- 停止全部 NAS 推图。

不新增定时启动、最大运行时长等控件。

### 17.4 账号 ID 映射

页面现有账号来自浏览器 Token Store，NAS API 需要 NAS 账号 ID。

启动前必须：

1. 调用账号同步或 NAS hydration。
2. 使用 `serverAccountId`、`nasTokenIdMap` 或角色 ID 映射到 NAS Token ID。
3. 未同步到 NAS 的账号禁止启动并显示原因。
4. 前端不能把本地随机 Token ID 直接传给 NAS API。

### 17.5 状态卡

每张卡片由 NAS API 数据驱动：

- 账号名称。
- NAS 会话状态。
- 当前关卡和 BOSS。
- 当前战斗倒计时。
- 胜、败、总场次。
- 连续失败。
- 火把状态。
- 最后一次心跳。
- 定时任务暂停/恢复状态。
- 被顶号时间 `kickedAt`。
- 下次重新登录时间 `reloginAt`。
- 最后错误。

当前已知显示问题：状态卡能显示剩余秒数，但进度条长期为 0。原因是服务端只持久化剩余
`battleTime`，没有单独保存本场初始时长；前端轮询时把剩余时间同时当作总时长。该问题只影响
展示，不影响战斗。修复方案已记录在
[future-roadmap.md](future-roadmap.md#6-主线推关进度条显示)。

浏览器页面卸载时：

- 只清理倒计时显示和轮询定时器。
- 不得调用 NAS 停止接口。
- 不得释放 NAS 会话账号锁。

### 17.6 状态轮询

页面可见时每 2 秒请求：

```text
GET /api/pushing/status
```

浏览器标签页切到后台时，轮询可以被浏览器降频；NAS 推图不受影响。

页面重新可见时立即刷新一次，不依赖历史轮询数据。

### 17.7 日志

NAS 模式不再使用页面内 `logs` 作为权威日志。

页面每次刷新：

```text
GET /api/logs/db?run_id=<push-run-id>&limit=200
```

前端只负责展示、筛选和自动滚动。

### 17.8 火把

火把仍由用户在现有页面手动设置：

- 火把类型。
- 数量。
- “使用火把”按钮。

NAS 模式点击“使用火把”时调用 NAS API，不直接建立浏览器游戏连接。

### 17.9 启动前确认

启动 NAS 推图前显示：

- 将占用账号直到手动停止。
- 自动任务出现时整个推图会话会暂停并自动恢复。
- 每 100 关会按配置消耗知识币升级挂机。
- 被顶号后会等待配置时间再重新登录。
- 关闭浏览器不会停止 NAS 推图。

### 17.10 批量日常页面边界

批量日常页面不新增推图入口、推图状态或推图日志。

推图的唯一人工入口仍是：

```text
默认布局 → 主线推关
```

## 18. 安全与隐私

- 不返回 Token、BIN、`roleToken`、`sessId` 或 `connId`。
- 所有推图 API 使用现有 API Key/App 登录保护。
- 日志继续经过 `sanitizeLogMessage`。
- 状态文件权限 `600`。
- 不在 URL、任务选项或前端 localStorage 中保存凭据。
- 推图不会自动使用火把、金砖或其他付费资源；火把只允许手动操作。

## 19. 错误分类

| 错误 | 处理 |
| --- | --- |
| `1006` / WebSocket 关闭 | 重连，最多 5 次 |
| `未连接` | 重连后继续 |
| 请求超时 | 查询真实状态，禁止盲目重放写操作 |
| `200750` | 重新读取 battleVersion |
| 角色身份不一致 | 尝试 BIN 修复，失败后暂停 |
| BIN 缺失 | 暂停账号，等待重新同步 |
| 连续结算未知 | 暂停账号 |
| 账号锁长期被占用 | 保持 queued，显示等待任务 |
| 自动任务需要推图账号 | 整个推图会话暂停，定时任务结束后自动恢复 |
| 被顶号 | 按配置延迟重新登录，避免连续互踢 |

## 20. 测试设计

### 20.1 单元测试

- 状态规范化和序列化。
- Run 启动、强制停止和容器恢复。
- 单场胜利推进关卡。
- 单场明确失败增加重试。
- 连续失败达到上限后暂停。
- `battleTime=0` 重试。
- `200750` 重新获取版本。
- `fight_level` 超时后通过关卡变化判定胜利。
- `fight_level` 超时且关卡不变，不重复结算。
- WebSocket 断开重连。
- Token 到期自动刷新。
- 缺少 BIN 暂停。
- 被顶号后按配置延迟重新登录。
- 连续被顶号不会立即高频重连。
- 手动使用火把在安全边界暂停并恢复。
- 定时任务暂停发生在安全边界。
- 容器重启时状态 reconcile。

### 20.2 多账号测试

- 不同账号并行。
- 同账号不会启动两个 Runner。
- 单账号失败不影响其他账号。
- maxConcurrent 生效。

### 20.3 与现有系统集成

- 自动推图持有账号锁时，00:05 任务进入队列。
- 推图完成当前战斗后，整个会话释放所有账号锁。
- 定时任务结束后，整个推图会话自动恢复。
- 定时任务失败重试时会再次暂停推图。
- 与十殿全局闸门兼容。
- 与手动租约兼容。
- 与 Token 自动刷新顺序兼容。

### 20.4 浏览器关闭验收

1. 从网页启动单账号 NAS 推图。
2. 确认日志持续增加。
3. 完全关闭浏览器。
4. 等待至少 15 分钟。
5. 重新打开网页。
6. 确认关卡、胜场和时间持续增长。

该测试需要用户明确授权后再执行真实战斗。

### 20.5 主线推关页面测试

- 本地账号正确映射到 NAS Token ID。
- 页面刷新后恢复 NAS 会话状态。
- 路由离开和组件卸载不会调用停止 API。
- 页面重新进入后日志和关卡连续。
- 浏览器模式不能与同账号 NAS 模式同时启动。
- NAS 火把按钮通过后端执行。
- 批量日常页面不存在新增推图入口。

## 21. 实施阶段

### 阶段 1：后端单账号引擎

- `pushState.js`
- `pushRunner.js`
- GameClient 命令补齐
- 单账号启动/停止 API
- Mock 单元测试

状态：已完成。

### 阶段 2：多账号与持久化

- `pushSessionManager.js`
- `pushing-runs.json`
- 并发上限
- 容器重启恢复
- 定时任务暂停/自动恢复
- 被顶号延迟重登

状态：已完成。

### 阶段 3：前端控制面板

- 改造 `src/views/PushingLevels.vue`
- NAS 模式启动和停止
- 状态轮询
- 日志
- 手动火把操作
- 本地账号到 NAS 账号 ID 映射
- 禁止浏览器模式重复运行

状态：已完成。

### 阶段 4：真实环境小规模验证

- 单账号、单场战斗验证
- 关闭浏览器 15 分钟验证
- 容器重启恢复验证
- 与 00:05 任务暂停和自动恢复验证
- 被顶号延迟重登验证

### 阶段 5：完整回归和部署

- 全量测试
- ESLint/Prettier
- Vite 构建
- NAS 镜像构建和部署

## 22. 验收标准

- 关闭浏览器后推图继续。
- 原“主线推关”页面完成改造，批量日常页面不增加推图入口。
- 页面重新打开可看到准确状态。
- 容器重启后不会重复结算。
- 同一账号不会出现两个在线会话。
- Token 过期可自动刷新。
- 没有最大运行时长，只有用户手动停止才结束会话。
- 定时任务出现时推图会自动暂停，任务结束后自动恢复。
- 推图停止后账号锁、连接和状态正确释放。
- 被顶号后按配置延迟重新登录。
- 火把只能由用户手动使用，不接受自动消耗。
- 任何异常都不会输出 Token、BIN 或会话凭据。
- 当前 329 项 Web/服务端测试和 17 项桌面端测试全部通过。

### 22.1 已知待优化

- NAS 推图状态卡进度条未显示，详见后续路线第 6 节。
- 需要专项验证关闭浏览器 15 分钟后仍持续推图。
- 需要专项验证 NAS 重启恢复和自动任务让锁。

## 23. 已确认规则

1. 不设置最大运行时长。
2. 遇到自动任务时，整个推图会话停止，任务结束后自动恢复。
3. 每 100 关自动升级挂机默认开启。
4. 只支持用户手动启动和手动停止，不做定时启动。
5. 火把由用户手动选择类型、数量并手动使用，推图不自动消耗。
6. 被顶号后的重新登录时间在启动时配置。
7. 页面保留浏览器 / NAS 切换，默认 NAS。
8. 最大并发可选 1～5，默认 5。
9. 手动停止立即强制断开，不等待当前战斗结算。

默认值：

```text
最大运行时长：无
最大并发：5，允许 1～5
定时任务策略：暂停整个会话，任务完成后自动恢复
每 100 关升级挂机：开启
定时启动：暂不实现
自动使用火把：关闭
被顶号重登延迟：5 分钟，可配置 0～120 分钟
手动停止：立即强制断开并释放账号锁
```
