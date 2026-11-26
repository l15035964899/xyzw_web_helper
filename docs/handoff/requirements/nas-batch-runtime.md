# NAS 批量调度与任务运行设计

> 状态：已实现
> 目标：浏览器关闭后，账号任务仍由 NAS 持续运行

## 1. 运行架构

单容器 `xyzw-nas-all`：

- Express 前端和 API
- Node 游戏 WebSocket
- NAS Cron
- 账号队列和租约
- 任务日志
- 十殿跨账号执行

容器：

```text
端口：3002:3000
重启：unless-stopped
健康接口：GET /health
存储：STORE_MODE=local
```

## 2. 权威数据

```text
tokens.json
cron-tasks.json
batch-settings.json
task-logs.jsonl
token-refresh-credentials.json
nightmare-runs.json
```

`tokens.json` 不返回完整 Token 给前端。BIN 凭据单独存储且权限为 `600`。

## 3. Cron

- 唯一定时来源：NAS `node-cron`
- 浏览器生命周期定时器不得作为正式调度
- 任务按 `priority` 从高到低注册
- 上海时区为业务时区

当前启用任务数量以 `/health.activeCrons` 和 `/api/tasks` 为准。

## 4. 账号锁与排队

- 同一账号不能同时被两个执行入口控制。
- 多个任务账号集合重叠时进入 FIFO 队列。
- 完全不重叠的任务可并行。
- 多账号锁按 ID 排序获取，避免死锁。
- 手动批量任务申请 90 秒 TTL 租约，每 30 秒续租。
- 页面关闭后租约过期，NAS 任务继续排队。
- 暂停、删除任务或移出账号时取消相关延期任务。

## 5. Token 刷新顺序

正确顺序：

1. 获取账号锁。
2. 检查/刷新 Token。
3. 建立游戏连接。
4. 校验真实角色。
5. 执行任务。

不能在持锁前刷新连接，否则可能把正在运行的会话挤掉。

详细规则见
[role-identity-and-token.md](role-identity-and-token.md)。

## 6. 安全重试

- 通用连接重试不适用于会重复购买、赠送或战斗的任务。
- 仅明确安全的自动任务允许失败后延时重试一次。
- 功法残卷首次开始但奖励未成熟走独立延期续跑，不记为失败。
- 手动执行默认不自动重试。

## 7. 周五维护

- 自动 Cron 在周五 `05:00–07:05 Asia/Shanghai` 避让。
- 维护窗口内触发的任务等待到 `07:05` 后补跑。
- 手动执行不受此避让限制。
- 维护避让不能被当作任务失败。

## 8. 日志

- 浏览器和 NAS 都使用 `{ time, message, type }`
- 时间格式：`MM-DD HH:mm:ss`
- 写入前脱敏密码、API Key、Token、`roleToken`、`sessId`、`connId`
- 普通页面显示最近 100 条
- “全部 ERROR”走独立 API，不能前端只过滤最近 100 条
- 每天 00:00 上海时间清理前天及更早日志
- 任务结束写 `taskCompleted`

接口：

```text
GET /api/logs/db?limit=100
GET /api/logs/db?status=error&limit=5000
GET /api/logs/db?run_id=<run-id>
GET /api/logs/db?task_id=<task-id>
GET /api/logs?limit=200
```

## 9. 批量日常页面

主要文件：

```text
src/views/BatchDailyTasks.vue
src/utils/batch/constants.js
src/utils/batch/tasksStore.js
render-backend/lib/nativeBatchTasks.js
render-backend/server.js
src/api/batchSchedules.js
```

页面能力：

- NAS 账号列表与同步
- 任务分组和参数
- 十殿配置入口
- Cron/每日固定时间
- 下次执行时间
- NAS 日志切换
- 手动执行

自动十殿必须单独成为一个定时任务。

## 10. 运行状态接口

```text
GET /api/tasks/runtime
```

返回：

- 正在运行的任务
- 手动租约
- 账号锁持有者

写入任务前先读取，避免与当前运行冲突。

## 11. 当前任务目录

任务定义来自：

- `src/utils/batch/constants.js`
- `render-backend/lib/nativeBatchTasks.js`
- `render-backend/lib/nativeBatchTasks.js` 的 `NATIVE_TASK_CATALOG`

新增任务时必须同时更新：

1. 前端任务列表
2. 后端任务目录
3. 执行 switch
4. 中文日志描述
5. 测试

## 12. 测试重点

```bash
node --test test/*.test.js
./node_modules/.bin/eslint src render-backend test --max-warnings 0
./node_modules/.bin/vite build
```

重点覆盖：

- FIFO 锁
- 不重叠账号并行
- 手动租约过期
- Token 刷新顺序
- 维护避让
- 任务完成日志
- 全量错误日志扫描
