# 周常礼包与日志设计文档

> 状态：招募周已完成；宝箱周、江湖黑市周待补
> 来源会话：“6.周常礼包领取优化”

## 1. 功能范围

该需求实际包含：

1. 主页“十殿礼包”免费礼包。
2. 招募周限时商店免费礼包。
3. 相关错误码降级。
4. 日志显示月和日。

## 2. 十殿礼包

入口：

```text
游戏主页 → 十殿礼包
```

不是十殿试炼活动页。

只领取第一个可见“免费”礼包。实测命令：

```text
activity_claimrolluppack
{"id":17}
```

行为：

- 成功：记录十殿免费礼包领取完成。
- `12000116`、`1000020`、`700020`、`3500020`：今日已领取，按 info 跳过。
- `200020`：在本场景下记录 warning“可能已领取，未重试”。

`200020` 是通用临时异常，不能在其他任务中全局认定已领取。

## 3. 招募周限时商店

入口：

```text
限时活动 → 周活动 → 限时商店 → 获得
```

领取命令：

```text
activity_buystoregoods
{"activityId":6,"goodsIndex":0,"buyNum":1}
```

领取前先发送：

```text
activity_get
```

判定：

- 活动 ID = `6`
- `type = 4` 表示招募周
- `myStoreInfo["6"].complete["0"] > 0` 表示本周已领取

只有“招募周 + 未领取”才发送购买命令。

`1100010` 在该场景表示本周限购奖励已领取，记录 warning。

## 4. 当前任务

线上配置：

| 名称 | Cron | 内容 | 账号 |
| --- | --- | --- | --- |
| 周常 | `30 0 * * MON` | 包含 `activity_claimrolluppack` | 12 |
| 周常免费礼包 | `01 12 * * FRI` | 包含 `activity_buystoregoods` | 12 |

任务配置可能变化，执行前调用 `/api/tasks` 重新确认。

## 5. 代码位置

```text
src/utils/xyzwWebSocket.js
render-backend/lib/gameClient.js
src/utils/batch/constants.js
src/utils/batch/tasksStore.js
render-backend/lib/nativeBatchTasks.js
src/views/BatchDailyTasks.vue
src/utils/serverTaskLog.js
render-backend/lib/taskLogDescriptions.js
src/utils/batch/logUtils.js
test/nativeBatchTasks.test.js
test/logTime.test.js
```

## 6. 日志时间

格式：

```text
MM-DD HH:mm:ss
```

覆盖：

- 浏览器本页日志
- NAS 日志
- 每日任务日志

旧日志如果只保存 `HH:mm:ss`，没有原始日期，只能用格式化当天补齐月日。
需要精确跨天历史时应读取 `created_at`。

## 7. 未完成事项

### 宝箱周

尚未抓包：

- 活动 ID、type。
- 商品索引。
- 状态字段。
- 错误码。

### 江湖黑市周

同上，需要在实际轮换到该周时验证。

### `1100010` 范围

当前在招募周任务和日志文案中降为 warning，但通用命令异常路径没有全局降级。
需确认用户是否要求所有任务统一按 warning 处理。

## 8. 验证重点

- 非招募周不得误买其他周商品。
- 已领取时不重复发送购买请求。
- `200020` 只允许在十殿礼包场景按“可能已领取”处理。
- 日志日期不能因为本地时区产生偏差。
