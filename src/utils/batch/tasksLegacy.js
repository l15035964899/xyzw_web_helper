/**
 * 功法类任务
 * 包含: batchLegacyClaim, batchLegacyGiftSendEnhanced
 */

const LEGACY_ITEM_ID = 37007;
const LEGACY_MIN_COLLECT_MS = 60_000;
const LEGACY_FIRST_REWARD_MS = 300_000;
const LEGACY_COLLECT_SETTLE_MS = 1_500;

/**
 * 创建功法类任务执行器
 * @param {object} deps - 依赖项
 * @returns {object} 任务函数集合
 */
export function createTasksLegacy(deps) {
  const {
    selectedTokens,
    tokens,
    tokenStatus,
    isRunning,
    shouldStop,
    ensureConnection,
    releaseConnectionSlot,
    connectionQueue,
    batchSettings,
    tokenStore,
    addLog,
    message,
    currentRunningTokenId,
    recipientIdInput,
    recipientInfo,
    securityPassword,
    giftQuantity,
    delayConfig,
  } = deps;

  /**
   * 批量领取功法残卷
   */
  const batchLegacyClaim = async () => {
    if (selectedTokens.value.length === 0) return;
    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);
      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始领取功法残卷: ${token.name} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);

        const legacyInfo = await tokenStore.sendMessageWithPromise(
          tokenId,
          "legacy_getinfo",
          {},
          5000,
        );
        let hangUpBeginTime = Number(
          legacyInfo?.roleLegacy?.hangUpBeginTime || 0,
        );
        const startedNow = hangUpBeginTime <= 0;
        if (startedNow) {
          const started = await tokenStore.sendMessageWithPromise(
            tokenId,
            "legacy_beginhangup",
            {},
            5000,
          );
          hangUpBeginTime = Number(
            started?.roleLegacy?.hangUpBeginTime || Date.now(),
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== ${token.name} 已自动开始收集功法残卷 ===`,
            type: "info",
          });
        }

        const waitMs = Math.max(
          0,
          Math.max(LEGACY_MIN_COLLECT_MS, LEGACY_FIRST_REWARD_MS) +
            LEGACY_COLLECT_SETTLE_MS -
            Math.max(0, Date.now() - hangUpBeginTime),
        );
        if (waitMs > 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== ${token.name} 功法残卷收集中，等待 ${Math.ceil(waitMs / 1000)} 秒后领取 ===`,
            type: "info",
          });
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        if (shouldStop.value) {
          tokenStatus.value[tokenId] = "stopped";
          return;
        }

        let legacyClaimResp;
        try {
          legacyClaimResp = await tokenStore.sendMessageWithPromise(
            tokenId,
            "legacy_claimhangup",
            {},
            5000,
          );
        } catch (error) {
          if (!/800040|12400000|12400160/.test(String(error.message))) {
            throw error;
          }
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: String(error.message).includes("12400000")
              ? `=== ${token.name} 领取过于频繁，奖励留待下次执行 ===`
              : `=== ${token.name} 暂未产生可领取残券，收集仍在继续，请稍后再次执行 ===`,
            type: "warning",
          });
          return;
        }
        const reward = Number(legacyClaimResp.reward?.[0]?.value || 0);
        const count = Number(
          legacyClaimResp.role?.items?.[LEGACY_ITEM_ID]?.quantity || 0,
        );
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} ${startedNow ? "已自动开始收集并领取" : "成功领取"}功法残卷${reward}，共有${count}个`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 领取功法残卷失败: ${error.message || "未知错误"}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量领取功法残卷结束");
  };

  /**
   * 增强版批量赠送功法残卷（含完善的验证和错误处理）
   */
  const batchLegacyGiftSendEnhanced = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) {
      message.warning("请先选择要操作的角色");
      return;
    }

    const recipientId = isScheduledTask
      ? batchSettings.receiverId
      : recipientIdInput.value;
    const password = isScheduledTask
      ? batchSettings.password
      : securityPassword.value;

    const giftConfig = {
      recipientId: Number(recipientId),
      itemId: 37007,
      quantity: Math.min(giftQuantity.value, 9999) || 0,
      serverName: recipientInfo.value?.serverName || "",
      name: recipientInfo.value?.name || "",
    };

    if (!isScheduledTask) {
      if (!giftConfig.recipientId || giftConfig.recipientId <= 0) {
        message.error("请输入有效的接收者ID");
        return;
      }

      if (giftConfig.quantity <= 0 || giftConfig.quantity > 9999) {
        message.error("赠送数量必须在1-9999之间");
        return;
      }
    }

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    let totalSuccess = 0;
    let totalFailed = 0;

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);
      let consecutiveErrors = 0;
      const maxRetries = 2;

      while (consecutiveErrors <= maxRetries && !shouldStop.value) {
        try {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== 开始赠送功法残卷: ${token.name} (尝试 ${consecutiveErrors + 1}/${maxRetries + 1}) ===`,
            type: "info",
          });

          await ensureConnection(tokenId);

          const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
          const legacyFragmentCount =
            Math.min(
              roleInfo?.role?.items?.[giftConfig.itemId]?.quantity,
              9999,
            ) || 0;
          if (isScheduledTask) {
            if (legacyFragmentCount === 0) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `=== ${token.name} 功法残卷不足，当前拥有: 0 ===`,
                type: "error",
              });
              tokenStatus.value[tokenId] = "failed";
              totalFailed++;
              break;
            }
            const rankroleinfo = await tokenStore.sendMessageWithPromise(
              tokenId,
              "rank_getroleinfo",
              {
                bottleType: 0,
                includeBottleTeam: false,
                isSearch: false,
                roleId: giftConfig.recipientId,
              },
              5000,
            );
            giftConfig.serverName = rankroleinfo?.roleInfo?.serverName || "";
            giftConfig.name = rankroleinfo?.roleInfo?.name || "";
            if (!rankroleinfo?.roleInfo?.roleId) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `=== ${token.name} 赠送功法残卷失败: 接收者${giftConfig.recipientId}不存在`,
                type: "error",
              });
              tokenStatus.value[tokenId] = "failed";
              totalFailed++;
              break;
            }
            giftConfig.quantity = legacyFragmentCount;
          }

          if (legacyFragmentCount < giftConfig.quantity) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `=== ${token.name} 功法残卷不足，当前拥有: ${legacyFragmentCount}，需要: ${giftConfig.quantity} ===`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
            totalFailed++;
            break;
          }

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== 开始解除安全密码验证 ===`,
            type: "info",
          });

          const commitPasswordResp = await tokenStore.sendMessageWithPromise(
            tokenId,
            "role_commitpassword",
            {
              password,
              passwordType: 1,
            },
            5000,
          );

          if (!commitPasswordResp) {
            throw new Error("安全密码验证请求无响应");
          }
          if (!commitPasswordResp.role?.statistics?.["que:wh:tm"]) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} === 密码解除失败,请检查密码是否配置正确 ===`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
            totalFailed++;
            break;
          }
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== 安全密码验证成功 ===`,
            type: "success",
          });

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} === 开始赠送功法残卷${giftConfig.quantity}个,目标:[${giftConfig.serverName}] ID:${giftConfig.recipientId} ${giftConfig.name} ===`,
            type: "info",
          });

          const legacySendGiftResp = await tokenStore.sendMessageWithPromise(
            tokenId,
            "legacy_sendgift",
            {
              itemCnt: giftConfig.quantity,
              legacyUIds: [],
              targetId: giftConfig.recipientId,
            },
            5000,
          );

          if (!legacySendGiftResp) {
            throw new Error("赠送请求无响应");
          }

          await tokenStore.sendMessage(tokenId, "role_getroleinfo");

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== ${token.name} 成功赠送功法残卷${giftConfig.quantity}个给[${giftConfig.serverName}] ID:${giftConfig.recipientId} ${giftConfig.name} ===`,
            type: "success",
          });

          tokenStatus.value[tokenId] = "completed";
          totalSuccess++;
          break;
        } catch (error) {
          consecutiveErrors++;
          console.error(`赠送失败: ${error.message}`);

          let errorMsg = error.message || "未知错误";

          if (errorMsg.includes("200160")) {
            errorMsg = "模块未开启";
          } else if (errorMsg.includes("timeout")) {
            errorMsg = "请求超时";
          } else if (errorMsg.includes("网络")) {
            errorMsg = "网络错误";
          }

          if (consecutiveErrors <= maxRetries && !shouldStop.value) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `=== ${token.name} 赠送功法残卷失败: ${errorMsg}，将在3秒后重试 ===`,
              type: "warning",
            });
            await new Promise((r) => setTimeout(r, delayConfig.long));
          } else {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `=== ${token.name} 赠送功法残卷失败: ${errorMsg}，已达最大重试次数 ===`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
            totalFailed++;
            break;
          }
        } finally {
          tokenStore.closeWebSocketConnection(tokenId);
          releaseConnectionSlot();
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
            type: "info",
          });
        }
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 批量赠送功法残卷完成: 成功 ${totalSuccess} 个，失败 ${totalFailed} 个 ===`,
      type: "success",
    });

    message.success(
      `批量赠送功法残卷结束，成功 ${totalSuccess} 个，失败 ${totalFailed} 个`,
    );
  };

  return {
    batchLegacyClaim,
    batchLegacyGiftSendEnhanced,
  };
}
