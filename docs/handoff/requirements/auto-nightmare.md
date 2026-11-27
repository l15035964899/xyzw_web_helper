# 自动十殿设计文档

> 状态：已实现并部署；共享主力序列、跨周、任务级可选层符咒已接入
> 实现提交：`3e40df5`、`f6656c7`
> 当前镜像：`ghcr.io/l15035964899/xyzw-nas-all:05b2ab6-nas-pushing-20261127-r1`
> 入口：批量日常 → 十殿配置
> 核心文件：`render-backend/lib/nightmareRunner.js`

## 1. 目标

自动完成十殿：

- 配置队伍、队长、主力和每个成员的预设阵容。
- 配置第 1～8 层首发与补刀顺序。
- 创建队伍、等待队员准备、由队长统一发起挑战。
- 失败后按配置重试，默认最多 3 次挑战。
- 支持周日 23:30 进入房间、跨周后继续第 8 层。
- 结束后解散队伍，并把所有账号恢复到竞技场阵容。
- 支持独立抢符咒任务。

## 2. 用户确认的规则

- 建队与开始挑战必须分开。
- 队员只需加入和准备；进入房间后所有操作由队长连接发送。
- 队员在准备完成后无需继续登录。
- 每层按配置顺序出战：第一人首发，后续依次补刀。
- 非主力五名武将全部阵亡时跳过。
- 主力全灭且没有恢复次数时跳过，继续寻找补刀。
- 只有主力使用恢复。
- 主力上一关残血，在下一关开始前恢复。
- 恢复次数不足时，残血继续挑战。
- 一次失败后从第 1 层重新开始。
- 默认同队最多 3 次挑战，即首次加 2 次重试；用户可配置为 1～3 次。
- 三次都失败后停止，不进行第 4 次挑战。
- 重试不自动补符咒；一套符准备给整个 3 次流程。
- 第 8 层跨周后的失败仍计入原最多挑战次数。

游戏侧每周每账号的 5 次挑战机会由服务器管理。脚本不自行伪造门票余量。

## 3. 配置模型

每套队伍包含：

```text
id
name
enabled
leaderTokenId
mainTokenId
members[]:
  tokenId
  formation 1..6
stages[]:
  layer 1..8
  order[]  首发到补刀顺序
maxRetries 0..2
maxAttempts maxRetries + 1
fastMode
fastWaitSeconds
crossWeek
```

队伍人数 `2～5`，最多 `3` 套配置。

## 4. 代码位置

| 职责 | 文件 |
| --- | --- |
| 配置弹窗、状态轮询、按钮 | `src/components/Nightmare/NightmareConfigModal.vue` |
| 前端配置默认值和重复校验 | `src/utils/nightmare.js` |
| 前端 API | `src/api/nightmare.js` |
| 后端配置规范化 | `render-backend/lib/nightmareSettings.js` |
| 建队、房间、挑战、恢复、符咒 | `render-backend/lib/nightmareRunner.js` |
| NAS API 和定时编排 | `render-backend/server.js` |
| 游戏协议 | `render-backend/lib/gameClient.js` |
| 原生任务挂载 | `render-backend/lib/nativeBatchTasks.js` |
| 运行状态 | `render-backend/lib/localStore.js`、`nightmare-runs.json` |
| 测试 | `test/nightmare.test.js`、`test/nightmareUi.test.js` |

## 5. 建队与准备

“创建队伍”调用 `prepare`：

1. 获取全队账号的 FIFO 锁。
2. 刷新到期 Token。
3. 连接全部账号并校验真实角色身份。
4. 切换每个成员的预设阵容并验证。
5. 同步十殿独立出战位。
6. 队长创建队伍，成员加入并准备。
7. 已在其他十殿队伍中的成员跳过。
8. 可用成员不足 2 人则失败。

如果游戏内已存在该配置对应的队伍，会复用现有队伍，不会再次切换预设阵容。
阵容不对时，用户需要先解散再重新创建。

创建队伍不会进入挑战房间，也不会消耗挑战机会。

## 6. 状态查询

- 当前配置页对活动队伍每 **2 分钟**刷新一次。
- 状态：

```text
none       未组队
team       已组队，尚未全部准备
ready      已组队并准备
challenge  已进入房间
running    自动任务运行中
busy       账号被其他任务占用
error      查询失败
```

- 手动在游戏内解散后，刷新会反映为未组队。
- 游戏队伍存在但配置主力不在成员中时，由队长自动解散。
- 配置页“删除队伍”只删除配置；只剩一套时按钮为灰色。

## 7. 挑战执行

每次尝试：

1. 从第 1 层开始。
2. 已通关层跳过。
3. 按该层配置顺序逐人尝试。
4. 不在房间的账号跳过。
5. 非主力全灭跳过。
6. 主力全灭且无法恢复时跳过。
7. 主力有损伤时按恢复额度尝试恢复。
8. Boss 清空或战报胜利则进入下一层。

恢复额度当前实现：

```text
1～3 层：1
4～6 层：2
7～8 层：3
```

若后续抓包证明是整房共享额度，再按实测结果调整。

## 8. 队长独占操作

以下命令必须由队长连接发送：

```text
nightmare_setfighter
nightmare_fight
nightmare_leadercomplete
nightmare_restore
nightmare_dismiss
matchteam_openteam
matchteam_dismiss
```

队员只负责：

```text
matchteam_join
matchteam_memberprepare
```

队员尝试操作房间会出现权限错误。

## 9. 连接与错误恢复

- 队长掉线最多重连 5 次。
- 每次重连后读取 `role_getroleinfo` 校验真实角色。
- 普通单条业务错误记录为“非致命错误”。
- 如果错误后房间已通关，继续下一层。
- `6100020`：战斗动画未结束，等待后重试结束指令，最多 4 次。
- `6100010`：房间已退出类状态，继续核实队伍。
- `7100010`、`7800320`：已解散/不在队伍类状态，继续确认。
- 队长确实无法恢复时，流程暂停并保留房间和队伍，等待人工指示。

## 10. 解散与阵容恢复

成功或最终失败都必须：

1. 队长发送 `nightmare_dismiss` 退出房间。
2. 读取真实 `matchTeamId`。
3. 发送 `matchteam_dismiss`。
4. 重新读取队伍信息，确认已经不存在。
5. 恢复每个账号各自的竞技场预设阵容。
6. 再次读取并验证目标阵容。

如果无法确认解散，禁止恢复阵容。保留现场并报告。

## 11. 跨周模式

推荐 Cron：

```text
30 23 * * 0
```

流程：

1. 周日 23:30 创建房间并挑战 1～7 层。
2. 到第 8 层前保存 `paused-cross-week`。
3. 释放账号锁并断开连接。
4. 周一 00:00 后获取锁、刷新 Token、重连、读取房间。
5. 房间仍处于第 8 层才继续。
6. 挑战次数继续沿用原尝试序号。

错误房间进度会停止，避免重复消耗。

内部 `forceCrossWeek` 仅用于调试，正常任务不要启用。

## 12. 极速模式

- 普通模式等待 `fightLimitTime + 3 秒`。
- 极速模式至少等待配置的 `fastWaitSeconds`，默认 5 秒。
- 极速模式随后发送 `nightmare_leadercomplete` 结束动画。
- 之前 20 分钟和不到 5 分钟的主要差异来自普通/极速等待策略。

## 13. 抢符咒

状态：已改为任务级可选层和可选数量。

每个“抢十殿符咒”定时任务独立保存：

- 勾选层：第 1～6 层任意组合。
- 每层目标数量：可选，留空按 1 张处理，范围 1～50。

规则：

- 只处理任务勾选层。
- 未选层不购买，也不记录未抢到警告。
- 先读角色已有符咒，已达目标数量的层跳过。
- 再读服务器实时商店库存。
- 同一层数量不足时逐张购买。
- 爱心不足时跳过。
- 商店库存为 0 时不再轮询等待。
- 每次购买后更新爱心和库存。
- 最后重新读角色状态，汇总已拥有、已抢到、未抢到和原因。
- 旧任务没有任务级配置时，继续兼容原默认规则。

任务配置示例：

```text
charmLayers: [2, 5, 6]
charmTargets: { 2: 1, 5: 2, 6: 1 }
```

默认优先级仍为 `2、5、1、3、4、6`，仅作用于勾选层。

## 14. API

```text
GET   /api/nightmare/status
GET   /api/nightmare/teams/:id/status[?refresh=1]
PATCH /api/nightmare/settings
POST  /api/nightmare/teams/:id/prepare
POST  /api/nightmare/teams/:id/disband
POST  /api/nightmare/teams/:id/start
POST  /api/nightmare/charm-purchase
```

批量任务 `nightmareChallenge` 必须单独存在，不能与其他任务混用。

定时任务列表不允许对 `nightmareChallenge` 点击“执行”。单队立即挑战只能从
十殿配置页的“开始挑战”进入。对应的 `/api/tasks/:id/run` 也会返回 409。

## 15. 重复账号规则

当前规则：

- 同一队伍内禁止重复账号。
- 不同队伍之间允许所有成员重复，包括队长、主力和普通队员。
- 共享账号按队伍顺序串行登录，不能同时进入多个十殿房间。

## 15.1 自动十殿序列

自动十殿固定为每周日 `23:50`：

```text
50 23 * * 0
```

任务会按十殿配置页面顺序读取全部启用队伍，关闭的队伍直接跳过。

跨周规则：

- 第一支实际执行的队伍强制跨周。
- 后续队伍只有在与所有已开启跨周队伍成员完全不重复时，才允许开启跨周。
- 与任一跨周队伍重复时，跨周开关关闭并置灰。
- 即使队伍当前关闭，只要与已确定的跨周队伍重复，跨周也必须关闭并锁定。
- 所有跨周队伍并行执行。
- 跨周队伍全部结束后，未跨周队伍按配置顺序逐队执行。
- 每队按自己的 `maxAttempts` 重试；次数用完后正常解散并进入后续流程。
- 全部队伍结束后，每个账号只恢复一次自己的竞技场阵容。

手动“开始挑战”：

- 只执行当前队伍。
- 不检查星期和时间。
- 忽略跨周开关，立即完整执行 1～8 层。
- 仍使用队伍配置中的挑战次数。

十殿序列期间，所有 NAS 定时任务暂停。等待期间同一任务重复触发只保留一次，
序列结束后补跑一次。手动执行普通任务也通过同一闸门等待。

解散确认异常：

- 普通挑战失败且确认解散：继续下一队。
- 重试后仍无法确认解散：停止后续流程，保持全局等待。
- 从十殿配置页手动解散成功，或接口确认队伍已清理后，解除全局等待。

涉及：

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

## 16. PR #436 结论

PR：https://github.com/w1249178256/xyzw_web_helper/pull/436

可参考：

- `NightmareTeamLab.vue` 的组队探索。
- `matchteam_*`、`nightmare_*` 协议字段。
- 极速模式和房间通知经验。
- `render-backend/scripts/probe-nightmare.js`。

不能整体合并：

- 依赖游戏页回传 WS 帧重建房间状态。
- 没有完整的 NAS 跨账号编排。
- 没有跨周、重试、解散确认、竞技场恢复和本项目符咒逻辑。
- 混入大量赛事、商店、推关等无关功能。

## 17. 验证

已覆盖：

- 配置规范化与重复账号。
- 首发/补刀、阵亡和恢复额度。
- 最多 3 次挑战。
- 队长重连和房间操作。
- 成功/失败解散。
- 解散前不恢复阵容。
- 跨周时间计算。
- 多队成员跨队重复与同队唯一。
- 跨周队伍成对成员互斥。
- 周日 23:50 自动序列和手动忽略跨周。
- 多队并行跨周、后续顺序执行。
- 定时任务全局等待与重复触发合并。
- 解散异常保持等待和手动清理后解除。
- 符咒优先级、库存和爱心不足。
- 自动抢符与 UI 序号。

禁止在没有明确授权时再次触发真实挑战。
