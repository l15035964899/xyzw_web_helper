# 角色身份与 Token 设计

> 状态：已实现并在线上验证
> 目标：防止 Token 串号后把任务执行到错误游戏角色

## 1. 身份来源

稳定角色身份优先级：

1. `expectedRoleId`
2. 账号名末尾的数字角色 ID
3. 不允许使用 Token payload 中的 `roleId` 作为最终身份

示例：

```text
AIRUI-0-82539560 → 期望角色 82539560
```

Token payload 的 `roleId` 可能对应平台账号或旧会话，不能作为游戏角色主键。

## 2. 执行前校验

任务拿完账号锁、刷新 Token、连接游戏后，必须调用：

```text
role_getroleinfo
```

实际返回：

```text
role.roleId
```

必须与稳定身份一致。不一致时：

1. 阻止本次任务写操作。
2. 记录角色身份错误。
3. 如果 NAS 保存了 BIN，尝试用 BIN 刷新 Token。
4. 刷新后的 Token 必须重新登录并再次读取真实角色。
5. 修复成功才继续任务。
6. 修复失败则停止该账号。

## 3. BIN

BIN 定义：

```text
游戏 POST /login/authuser 的二进制请求体
```

它不是：

- 抖音 APK
- 普通网页缓存
- 未完成游戏授权的网页登录态
- 任意二进制文件

BIN 的敏感级别等同账号密码。

存储：

```text
token-refresh-credentials.json
权限：600
```

查询账号 API 不返回 BIN。

## 4. Token 自动刷新

- 默认阈值：约 20 小时
- 使用 BIN 调官方 `login/authuser`
- 新 Token 覆盖前必须验证真实角色
- 同一时间只执行一个刷新流程
- 多账号刷新之间默认间隔 2.5 秒
- 刷新必须发生在账号锁获取之后
- 浏览器旧 Token 不能覆盖 NAS 新 Token

接口：

```text
GET  /api/token-refresh/status
POST /api/token-refresh/run
PUT  /api/tokens/:id/refresh-credential
```

## 5. 重复角色

预期角色重复的账号组必须整组阻止，不能猜测其中一个继续执行。

这与十殿跨队伍业务重复不同：

- Token/账号身份重复：安全风险，必须阻止。
- 十殿配置跨队复用：业务规则，未来可能允许。

## 6. 持久化字段

```text
expected_role_id
last_verified_role_id
role_identity_verified_at
role_identity_error
```

前端 Token 模型对应：

```text
expectedRoleId
lastVerifiedRoleId
roleIdentityVerifiedAt
roleIdentityError
serverAccountId
nasSyncedAt
```

## 7. 代码位置

```text
render-backend/lib/roleIdentity.js
src/utils/roleIdentity.js
render-backend/lib/tokenRefresh.js
render-backend/lib/dailyTaskRunner.js
src/utils/dailyTaskRunner.js
render-backend/lib/localStore.js
render-backend/server.js
src/stores/tokenStore.ts
src/utils/serverTokenSync.js
src/utils/nasTokenBootstrap.js
supabase/migrations/202611200001_role_identity_verification.sql
```

测试：

```text
test/roleIdentity.test.js
test/roleIdentityRepairWiring.test.js
test/tokenRefresh.test.js
test/serverTokenSync.test.js
test/nasTokenBootstrap.test.js
```

## 8. 验收

- Token 登录到其他角色时必须停止。
- BIN 修复成功后只执行修复后的同一角色。
- 修复失败不能继续写操作。
- 重复预期角色整组停止。
- Token 刷新不能抢掉运行中的连接。
- Token、`roleToken`、BIN 不能出现在日志或 API 响应中。
