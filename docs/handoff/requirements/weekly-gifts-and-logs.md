# 周常礼包与日志设计文档

> 状态：招募周、宝箱周已实现并部署；江湖黑市周待抓包补充
> 来源会话：“6.周常礼包领取优化”

部署验证：

- 实现提交：`935ca63`
- 当前镜像：`ghcr.io/l15035964899/xyzw-nas-all:05b2ab6-nas-pushing-20261127-r1`
- 部署日期：2026-11-27。
- 线上按钮已改为“领取周常免费礼包”。
- `安安-0-101336362` 在线上识别为宝箱周，已领取状态识别正常，没有重复发送领取请求。

## 1. 功能范围

该需求实际包含：

1. 主页“十殿礼包”免费礼包。
2. 周常限时商店免费礼包。
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

## 3. 周常免费礼包

入口：

```text
限时活动 → 周活动 → 限时商店 → 获得
```

任务名称：

```text
领取周常免费礼包
```

任务先发送 `activity_get`，按当前活动列表中的限时商店活动 ID 判断周常类型。
活动类型 `4` 同时用于招募周和宝箱周，不能单独作为招募周判断条件。

已抓取协议：

```text
// 招募周
activity_buystoregoods
{"activityId":6,"goodsIndex":0,"buyNum":1}

// 宝箱周
activity_buystoregoods
{"activityId":7,"goodsIndex":0,"buyNum":1}
```

当前识别规则：

- `activityId = 6`：招募周。
- `activityId = 7`：宝箱周。
- 两项活动类型均为 `type = 4`。
- 读取 `myStoreInfo[activityId].complete[goodsIndex]`，值大于 `0` 表示本周已领取。
- 线上解码结果中的 `myStoreInfo`、`complete` 可能是 `Map`，前端和 NAS 后端均兼容 `Map` 与普通对象。

判定：

- 只对已抓包的活动 ID 发送购买请求。
- 未知周常不会猜测参数，也不会购买其他周商品。
- 只有当前活动未领取时才发送 `activity_buystoregoods`。

宝箱周实测：

- 当前周为宝箱周，限时商店活动 ID 为 `7`。
- 免费礼包为 `goodsIndex = 0`，奖励为白玉 ×100、青铜宝箱 ×10。
- 领取后界面出现“恭喜获得”，商品状态变为 `1/1` 并显示已领取。
- `myStoreInfo` 中 `complete[0]` 变为 `1`。
- 本次未出现错误码。

`1100010`、`12000116`、`1000020`、`700020`、`7900023` 在该场景均按“可能已领取”处理并记录 warning。

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

### 江湖黑市周

下周轮换到江湖黑市周后，需要抓取：

- 限时商店活动 ID。
- 免费商品索引。
- 领取请求参数。
- 成功响应、状态字段和错误码。

抓包完成后，将对应协议加入 `render-backend/lib/weeklyStore.js` 的
`WEEKLY_STORE_PROTOCOLS` 即可，无需修改任务主流程。

### `1100010` 范围

当前在招募周任务和日志文案中降为 warning，但通用命令异常路径没有全局降级。
需确认用户是否要求所有任务统一按 warning 处理。

## 8. 验证重点

- 未抓包或未识别的周常不得误买其他周商品。
- 已领取时不重复发送购买请求。
- `200020` 只允许在十殿礼包场景按“可能已领取”处理。
- 日志日期不能因为本地时区产生偏差。
