# 后续功能路线

> 状态：未实现或待确认
> 本文件只记录设计方向，不代表已经上线

## 0. PR 评估记录

### PR #433：怪异塔聚合任务

链接：https://github.com/w1249178256/xyzw_web_helper/pull/433

状态：已完成本地代码接入，待后续提交。

采用内容：

- 新增“一键怪异塔领取+使用+合成”。
- 先领取免费道具，再循环使用钥匙。
- 棋盘满或开箱失败时，先合成腾位，再继续使用。
- 每轮都尝试领取累计消耗奖励，避免多轮消耗后漏领。
- 每次重新读取剩余钥匙和累计消耗，避免使用本地旧值。
- 连续 3 轮“没有成功使用且合成无进展”才停止。
- 外层最多 50 轮，防止死循环。
- `12300040` 棋盘满按可恢复状态处理。
- `200160` 模块未开启按账号 warning 跳过，不再重试三次。
- `batchMergeItems` 区分读取失败、真实合成和无物品可合。
- 保留原有“领取免费道具 / 使用道具 / 合成”三个独立按钮。

本项目接入范围：

- 浏览器按钮与任务分组。
- NAS 原生任务目录与执行器。
- 聚合任务日志中文名。
- 棋盘满续用和模块未开启测试。

### PR #439：日常接口与宝库清理

链接：https://github.com/w1249178256/xyzw_web_helper/pull/439

状态：仅评估，未整体合并。

#### 值得采用

1. **竞技场免费次数**
   - PR 使用官方统计键 `area:arena:last`。
   - 根据今日已使用次数动态计算剩余免费次数。
   - 能处理“每日任务 13 已领奖，但免费次数尚未打满”的情况。
   - 建议保留本项目现有的稳健目标选择逻辑，只替换次数计算和循环条件。

2. **移除已下线宝库**
   - 删除 `BossTower.vue`。
   - 删除 `batchbaoku13`、`batchbaoku45`。
   - 删除宝库 Tab、活动开放判定、事件监听和任务映射。
   - 本项目当前仍保留这些代码，可作为后续清理候选。
   - 执行前需要确认用户不再需要旧宝库入口，并检查现有 NAS 任务是否引用。

3. **官方配置版本回退**
   - PR 指出 `dataBundleVer` 是 Cocos bundle 哈希，不能直接当作旧版 CDN 数据目录版本。
   - PR 改为先读 `/data/version.json`。
   - 2026-11-26 实测该接口存在，当前返回 `{"version":"da6870e190"}`。
   - 本项目当前已经使用 Cocos manifest 解析 `DailyTaskConf`，并保留旧配置回退，不能直接用 PR 版本覆盖。
   - 可考虑把 `/data/version.json` 作为第三层兼容回退，而不是替换现有主路径。

#### 不建议直接使用

- PR 基于较早版本，`BatchDailyTasks.vue` 会回退当前已有的分页、日志、NAS 调度和十殿 UI。
- 竞技场的 `roleList[0].roleId` 解析比本项目 `pickArenaTargetId` 更脆弱。
- 不能整 PR cherry-pick，应按功能重新实现。

#### 推荐优先级

1. 先验证并接入 `area:arena:last` 免费次数修复。
2. 再检查并移除宝库残留。
3. 最后评估 `data/version.json` 是否作为当前配置加载的额外回退。

## 1. 抢符咒改为可选层

当前：

- 检查第 1～6 层。
- 默认每层目标 1 张。
- 顺序为 `2、5、1、3、4、6`。

目标：

- 用户可以选择只抢某些层，例如 2、5、6。
- 未选层不查询、不购买、不记录未抢到警告。
- 已拥有和爱心不足规则继续保留。

待确认：

- 选择是全局配置还是每个定时任务独立配置。
- 是否需要为每层单独设置目标数量。

代码入口：

```text
render-backend/lib/nightmareSettings.js
render-backend/lib/nightmareRunner.js
src/utils/nightmare.js
src/components/Nightmare/NightmareConfigModal.vue
render-backend/lib/nativeBatchTasks.js
test/nightmare.test.js
```

## 2. 竞技场清票

需求：

- 批量日常增加“竞技场清票”按钮。
- 提供可设置次数输入框，例如 500 次。

当前任务区别：

- `batcharenafight` 固定最多 3 次。
- `batchTopUpArena` 是补齐月度进度。

建议：

- 实际次数取 `min(目标次数, 当前咸神门票)`。
- 结束后恢复原竞技场阵容。
- 记录每账号目标、实际执行、剩余门票和失败原因。

待确认：

- 单账号次数上限。
- 失败是否继续下一场。
- 是否加入 NAS 定时任务。

代码入口：

```text
src/views/BatchDailyTasks.vue
src/utils/batch/constants.js
src/utils/batch/tasksArena.js
render-backend/lib/nativeBatchTasks.js
render-backend/lib/taskLogDescriptions.js
src/utils/serverTaskLog.js
test/nativeBatchTasks.test.js
```

## 3. 周常轮换补全

已完成：

- 招募周。

待完成：

- 宝箱周限时商店。
- 江湖黑市周限时商店。

需要实机抓取：

- 活动 ID、type。
- 商品索引和数量。
- 是否免费。
- 已领取状态字段。
- 错误码。

见
[weekly-gifts-and-logs.md](weekly-gifts-and-logs.md)。

## 4. 三套十殿共享主力

当前：

- 禁止账号在同队和跨队重复。

未来可能：

- 三套队伍共享一个主力账号。

待确认：

- 只允许主力重复，还是所有成员都可重复。
- 共享账号的队伍如何串行执行。
- 不同队伍保存不同预设阵容时，谁是最终竞技场恢复目标。

相关代码：

```text
src/utils/nightmare.js
src/components/Nightmare/NightmareConfigModal.vue
render-backend/lib/nightmareSettings.js
render-backend/server.js
test/nightmare.test.js
test/nightmareUi.test.js
```

## 5. 运行状态持久化

当前部分运行队列和状态缓存在内存中。跨周十殿状态已写入
`nightmare-runs.json`，但容器重启后仍需通过 API 检查和恢复。

可考虑：

- 持久化队列状态。
- 持久化维护等待。
- 持久化手动租约。
- 容器重启后自动恢复未完成任务。

## 6. 事务与备份

当前 NAS 本地 JSON/JSONL 是权威数据。

后续建议：

- 定期备份 `data/`。
- 对写文件进行原子替换和校验。
- 为账号、任务、设置和日志提供恢复演练。

## 7. 镜像可追溯

当前镜像可能只存在于构建机和 NAS 本地。

后续建议：

- 推送不可变镜像到用户可控制的 GHCR。
- 记录源码 commit、构建时间和镜像 digest。
- NAS 部署只引用已验证镜像。
