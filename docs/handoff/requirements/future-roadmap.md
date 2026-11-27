# 后续功能路线

> 状态：近期功能已实现并部署，剩余待优化事项继续记录
> 本文件记录已实现功能摘要、已知问题和后续方向

## 0. PR 评估记录

### PR #433：怪异塔聚合任务

链接：https://github.com/w1249178256/xyzw_web_helper/pull/433

状态：已实现、提交并部署（`8e8b6d6`）。

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

状态：已实现并部署（2026-11-27）。

已确认规则：

- 选择按每个定时任务独立保存，不与其他抢符任务共享。
- 只处理任务勾选的第 1～6 层。
- 每层目标数量可选；留空按 1 张处理，范围 1～50。
- 未选层不购买、不记录未抢到警告。
- 已拥有、爱心不足、商店库存不足规则继续保留。
- 同一层目标大于 1 时逐张购买，直到达到目标或遇到库存/爱心限制。
- 旧任务没有任务级配置时，兼容原默认规则。

任务配置模型：

```text
options.charmLayers  = [2, 5, 6]
options.charmTargets = { 2: 1, 5: 2, 6: 1 }
```

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

状态：已实现并部署（2026-11-27）。

已确认规则：

- 批量日常增加“竞技场清票”按钮和次数输入框。
- NAS 定时任务增加独立“竞技场清票”选项。
- 每次最多执行 100 次，目标次数也限制为 1～100。
- 实际次数取 `min(目标次数, 当前咸神门票, 100)`。
- 无论战斗胜利、失败或单场异常都继续下一场。
- 连接级错误和用户停止请求仍会中止，避免无效空转。
- 结束后恢复执行前的竞技场阵容。
- 记录每账号目标次数、计划次数、实际发起次数、异常次数和剩余门票。
- 竞技场开放时间为上海时间 `06:00-22:00`。
- NAS 任务在非开放时间连接账号前直接记录日志并正常结束。
- 批量日常执行前同样校验时间，非开放时间记录日志后结束。
- 任务执行中到达 `22:00` 时提前停止，并照常恢复竞技场阵容。
- 非开放时间跳过视为正常业务状态，不触发失败重试。

与旧任务的区别：

- `batcharenafight` 固定最多 3 次。
- `batchTopUpArena` 按月度进度补齐。
- `batchArenaClearTickets` 按门票和目标次数清票。

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

状态：已实现并部署（2026-11-27），待真实多队跨周演练。

已实现规则：

- 同一队伍内禁止重复账号。
- 不同队伍允许所有成员重复，包括主力、队长和普通成员。
- 自动十殿固定为周日 `23:50`，按配置顺序执行全部启用队伍。
- 第一支实际执行队伍强制跨周。
- 跨周队伍必须两两成员完全不重复，并并行执行。
- 与任一跨周队伍重复时，后续队伍跨周关闭并置灰。
- 关闭状态的队伍同样执行跨周冲突校验，不能靠先关闭队伍绕过限制。
- 跨周队伍全部完成后，未跨周队伍按配置顺序执行。
- 每队使用自己的挑战次数，次数用完后继续后续队伍。
- 全部队伍结束后统一恢复账号竞技场阵容。
- 序列期间暂停所有 NAS 定时任务；重复触发只补跑一次。
- 定时任务列表禁止手动执行自动十殿。
- 十殿配置页的单队立即执行忽略时间与跨周。
- 解散无法确认时保持全局等待，手动清理成功后解除。

最终竞技场恢复目标为账号自己的竞技场阵容，不采用任何一队的十殿成员预设。

相关代码：

```text
src/utils/nightmare.js
src/components/Nightmare/NightmareConfigModal.vue
render-backend/lib/nightmareSettings.js
render-backend/lib/nightmareSequenceGate.js
render-backend/lib/nightmareSequenceState.js
render-backend/server.js
test/nightmare.test.js
test/nightmareUi.test.js
```

## 5. NAS 原生自动推关

状态：已实现、提交并部署（2026-11-27），单账号在线运行通过。

已实现能力：

- 改造现有“主线推关”页面，保留浏览器 / NAS 切换，默认 NAS。
- NAS 持有账号连接后，关闭浏览器或路由离开页面不会停止推图。
- 最大并发 `1～5`，默认 `5`；账号数超过并发数时按账号轮转分片，避免只推第一个账号。
- 自动任务等待任一推图账号时，整个会话在当前战斗结算后暂停、断开并释放全部账号锁；任务结束后自动恢复。
- 手动停止立即强制断开并释放锁，不等待当前战斗结束。
- 被顶号后按会话配置的 `0～120` 分钟延迟无限重登，并累计顶号次数。
- 每个 100 关自动升级挂机默认开启，可按会话关闭。
- 火把只允许用户手动选择类型、数量并点击使用，推图循环不会自动消耗。
- `fight_level` 超时后先读取真实关卡确认结果，禁止盲目重复发送结算。
- `pushing-runs.json` 持久化会话，NAS 容器重启后自动恢复未停止会话。
- SIGTERM/SIGINT 退出前强制保存推图状态。
- 页面轮询 NAS 状态和权威任务日志；卸载页面只清理浏览器定时器，不停止 NAS 会话。
- 同一账号在 NAS 推图期间禁止再从浏览器模式启动。

后端入口：

```text
render-backend/lib/pushState.js
render-backend/lib/pushRunner.js
render-backend/lib/pushSessionManager.js
render-backend/server.js
```

前端入口：

```text
src/views/PushingLevels.vue
src/api/pushing.js
```

接口：

```text
POST /api/pushing/runs
GET  /api/pushing/status
GET  /api/pushing/runs/:id
POST /api/pushing/runs/:id/stop
POST /api/pushing/runs/:id/use-torch
```

完整规则见 [nas-auto-pushing.md](nas-auto-pushing.md)。

## 6. 主线推关进度条显示

状态：已记录，待优化。

当前现象：

- NAS 推图状态卡能显示“战斗剩余 Ns”，但进度条一直为空。
- 浏览器模式进度条逻辑正常，问题只在 NAS 状态卡的数据模型。

原因：

- 前端 NAS 卡片把接口返回的 `account.battleTime` 同时赋给 `countdown` 和 `totalTime`。
- 服务端每次轮询只保存当前剩余时间，没有单独保存本场初始时长或预计结束时间。
- `progressPercent = 1 - countdown / totalTime` 因此长期接近 `0`。

后续方案：

1. 账号战斗开始时持久化 `battleDurationSeconds`。
2. 同时保存 `battleStartedAt` 或 `battleEndsAt`。
3. 状态 API 返回本场总时长和当前剩余时长。
4. 前端使用真实总时长计算百分比，并在服务器重启恢复后按真实结束时间校正。
5. 为进度 0%、中间值、完成和恢复场景补测试。

## 7. 运行状态持久化

当前跨周十殿状态已写入 `nightmare-runs.json`，NAS 推图会话已写入
`pushing-runs.json`，两者都会在容器启动后检查并恢复。

仍需补强：

- 持久化维护等待。
- 持久化手动租约。
- 对普通定时任务尚在内存中的队列和执行状态做恢复设计。

## 8. 事务与备份

当前 NAS 本地 JSON/JSONL 是权威数据。

后续建议：

- 定期备份 `data/`。
- 对写文件进行原子替换和校验。
- 为账号、任务、设置和日志提供恢复演练。

## 9. 镜像可追溯

当前镜像可能只存在于构建机和 NAS 本地。

后续建议：

- 推送不可变镜像到用户可控制的 GHCR。
- 记录源码 commit、构建时间和镜像 digest。
- NAS 部署只引用已验证镜像。

当前部署镜像：

```text
ghcr.io/l15035964899/xyzw-nas-all:05b2ab6-nas-pushing-20261127-r1
```

该镜像由提交前的同一工作区构建，功能内容对应 `1fb7ca6` 和 `792bcfc`。
