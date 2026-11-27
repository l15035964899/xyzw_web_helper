# 需求设计文档索引

本目录保存各功能的独立设计和维护说明。新增需求时优先新建文档，并从
[整体交接方案](../OVERALL_HANDOFF.md) 和本索引链接过去。

| 文档 | 内容 |
| --- | --- |
| [auto-nightmare.md](auto-nightmare.md) | 自动十殿、共享主力序列、跨周、可选层符咒和阵容恢复 |
| [weekly-gifts-and-logs.md](weekly-gifts-and-logs.md) | 十殿礼包、周常免费礼包、错误码和日志时间 |
| [nas-batch-runtime.md](nas-batch-runtime.md) | NAS Cron、账号锁、租约、推图会话协调和持久化 |
| [role-identity-and-token.md](role-identity-and-token.md) | 角色身份校验、BIN 续期和防串号 |
| [desktop-client-and-bin.md](desktop-client-and-bin.md) | Electron 客户端和临时 BIN 通道 |
| [daily-task-reliability.md](daily-task-reliability.md) | 每日任务、宝箱、黑市、功法残卷、竞技场清票和错误处理 |
| [nas-auto-pushing.md](nas-auto-pushing.md) | NAS 原生自动推图、并发、重登、持久化、账号让锁和手动火把 |
| [future-roadmap.md](future-roadmap.md) | 近期功能实现摘要、推图进度条待优化项和后续路线 |

维护原则：

- 一个稳定功能一份文档。
- 总交接只保留摘要和链接。
- 需求完成后更新“当前实现”“代码位置”“验证方式”“未完成事项”。
- 不把临时调试过程写进总交接。
