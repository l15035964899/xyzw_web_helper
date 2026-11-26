# 日常任务可靠性设计

> 状态：已完成主要修复
> 目标：按服务器实际状态补差，不重复消耗资源

## 1. 原则

- 每次执行先读取服务器当前状态。
- 已完成但未领取的任务只领取，不重复执行。
- 单个业务错误不能中断其他任务类型。
- 不能凭界面提示判断成功。
- 有写操作的任务不能随意整账号重跑。
- 无法确认结果时保留待继续状态。

## 2. 官方每日任务配置

服务器返回任务配置版本后，优先读取当前 Cocos 资源包：

```text
https://xxz-xyzw-res.hortorgames.com/remote/config/config.<version>.json
```

从 manifest 解析 `DailyTaskConf` 资源。

兼容回退：

```text
/data/<version>/config.json
```

代码：

```text
render-backend/lib/dailyTaskState.js
src/utils/dailyTaskState.js
test/dailyTaskState.test.js
```

## 3. 宝箱

规则：

- 优先钻石宝箱 `2005`。
- 钻石箱库存不少于 3 时选择钻石箱。
- 否则使用用户配置的箱子类型。
- 单次数量使用界面当前可见库存数量，即 `min(库存, 10)`。
- 不能固定写回 3。

实测：

```text
库存 9，请求 3 → 400122
库存 9，请求 10 → 400010
库存 9，请求 9 → 成功
```

代码：

```text
render-backend/lib/dailyTaskRunner.js
src/utils/dailyTaskRunner.js
```

## 4. 黑市

日常黑市步骤：

1. 先使用游戏内已有采购配置执行一键采购。
2. 只读取服务器进度。
3. 未完成时发送：

```text
store_buy
{"goodsId":3}
```

购买 1 个铂金宝箱。

禁止：

- 覆写游戏已保存的一键采购清单。
- 为完成日常而替换用户黑市配置。

独立的“一键配置黑市采购清单”任务仍由用户显式配置。

## 5. 功法残卷

流程：

1. `legacy_getinfo`
2. 未开始则 `legacy_beginhangup`
3. 首张奖励约 5 分钟成熟
4. 自动任务首次不阻塞等待，记录 `deferred`
5. 约 6 分钟后自动续跑领取
6. 已成熟时立即领取
7. `12400000` 领取过于频繁时保留到下次
8. `800040`、`12400160` 按未成熟处理

代码：

```text
render-backend/lib/nativeBatchTasks.js
src/utils/batch/tasksLegacy.js
render-backend/lib/taskRetry.js
render-backend/server.js
```

## 6. 战斗版本

战斗前调用：

```text
fight_startlevel
```

读取最新 `battleData.version`，不能使用固定版本。

已修复竞技场 `200750` 战斗版本失效问题。

## 7. 可预期跳过

以下返回通常属于业务状态，不是系统故障：

```text
1000020  今日奖励已领取
12000116 今日免费奖励已领取
1400010  未购买月卡
3500020  没有可领取奖励
700020   已经领取过
2600040  梦境阵容已选择
1100010  本周限购已领取（对应场景）
```

是否降级必须结合任务上下文，不能全部全局忽略。

## 8. 日常结果状态

账号状态：

- `completed`：所有步骤完成
- `pending`：存在未完成或延期步骤
- `failed`：执行异常
- `stopped`：用户停止

服务器已领取但本地尚未领取的步骤仍需返回 pending，直到奖励确认领取。

## 9. 已知错误

| 错误 | 含义 | 处理 |
| --- | --- | --- |
| `400122` | 开箱数量/库存拒绝 | 保留任务待继续，不更换箱子规避 |
| `400010` | 物品不足 | 记录并保留 |
| `200020` | 临时服务器问题 | 不盲目重试领奖 |
| `200750` | 战斗版本无效 | 重新读取最新版本 |
| `12400160` | 尚未开始收集 | 先开始功法残卷 |
| `1100010` | 本周限购已领取 | 对应活动按 warning |

## 10. 验证

重点测试：

```text
test/dailyTaskRunner.test.js
test/dailyTaskState.test.js
test/nativeBatchTasks.test.js
test/renderBackendTasks.test.js
test/taskRetry.test.js
test/batchDailyRun.test.js
```

覆盖：

- 已完成任务不重复消耗
- 失败写操作不整账号重放
- 宝箱可见库存
- 钻石箱优先级
- 黑市不覆写配置
- 功法残卷延期
- 单业务错误不阻断其他任务
