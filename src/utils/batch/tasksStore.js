/**
 * 商店类任务
 * 包含: legion_storebuygoods, legionStoreBuySkinCoins, store_purchase,
 * store_syncpurchaseconfig, collection_claimfreereward
 */

import { detectWeeklyStoreState } from "../../../render-backend/lib/weeklyStore.js";
import {
  compareBlackMarketPurchaseLists,
  normalizeBlackMarketPurchaseList,
  toStorePurchaseItemList,
} from "./blackMarketConfig";

const TEN_DAY_FREE_GIFT_ID = 17;

/**
 * 创建商店类任务执行器
 * @param {object} deps - 依赖项
 * @returns {object} 任务函数集合
 */
export function createTasksStore(deps) {
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
    currentRunningTokenId,
    delayConfig,
  } = deps;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const getBlackMarketPurchaseConfig = () =>
    normalizeBlackMarketPurchaseList(batchSettings.blackMarketPurchaseList);

  const readBlackMarketPurchaseConfig = async (tokenId) => {
    const result = await tokenStore.sendMessageWithPromise(
      tokenId,
      "store_getpurchase",
      {},
      5000,
    );

    return {
      purchaseCnt: Number(result?.purchaseCnt || 0),
      purchaseItemList: normalizeBlackMarketPurchaseList(
        result?.purchaseItemList || [],
      ),
    };
  };

  const updateBlackMarketPurchaseConfig = async (tokenId, tokenName) => {
    const configuredPurchaseList = getBlackMarketPurchaseConfig();

    if (configuredPurchaseList.length === 0) {
      throw new Error("未配置黑市采购清单");
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 正在读取当前黑市采购清单...`,
      type: "info",
    });

    const currentPurchaseConfig = await readBlackMarketPurchaseConfig(tokenId);

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 当前黑市清单: ${currentPurchaseConfig.purchaseItemList.length} 项，共 ${currentPurchaseConfig.purchaseCnt} 次`,
      type: "info",
    });

    if (
      compareBlackMarketPurchaseLists(
        currentPurchaseConfig.purchaseItemList,
        configuredPurchaseList,
      )
    ) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 黑市采购清单已是目标配置，跳过下发`,
        type: "info",
      });

      return;
    }

    const purchaseCnt = Math.max(1, currentPurchaseConfig.purchaseCnt || 1);
    const purchaseItemList = toStorePurchaseItemList(configuredPurchaseList);

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 正在下发黑市采购清单...`,
      type: "info",
    });

    await tokenStore.sendMessageWithPromise(
      tokenId,
      "store_setpurchase",
      {
        purchaseCnt,
        purchaseItemList,
      },
      5000,
    );

    await sleep(delayConfig.action);

    const verifiedPurchaseConfig = await readBlackMarketPurchaseConfig(tokenId);

    if (
      !compareBlackMarketPurchaseLists(
        verifiedPurchaseConfig.purchaseItemList,
        configuredPurchaseList,
      )
    ) {
      throw new Error("黑市采购清单写回后校验失败");
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 黑市采购清单已更新 ${purchaseItemList.length} 项`,
      type: "success",
    });
  };

  /**
   * 一键购买四圣碎片
   */
  const legion_storebuygoods = async () => {
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
          message: `=== 开始购买四圣碎片: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送购买请求...`,
          type: "info",
        });

        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "legion_storebuygoods",
          { id: 6 },
          5000,
        );

        await sleep(delayConfig.action);

        if (result.error) {
          if (result.error.includes("俱乐部商品购买数量超出上限")) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 本周已购买过四圣碎片，跳过`,
              type: "info",
            });
          } else if (result.error.includes("物品不存在")) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 盐锭不足或未加入军团，购买失败`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
          } else {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 购买失败: ${result.error}`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
          }
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 购买成功，获得四圣碎片`,
            type: "success",
          });
          tokenStatus.value[tokenId] = "completed";
        }
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 购买过程出错: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 一键购买俱乐部5皮肤币
   */
  const legionStoreBuySkinCoins = async () => {
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
          message: `=== 开始购买俱乐部5皮肤币: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送购买请求...`,
          type: "info",
        });

        let result = null;
        for (let i = 0; i < 5; i++) {
          if (shouldStop.value) break;

          result = await tokenStore.sendMessageWithPromise(
            tokenId,
            "legion_storebuygoods",
            { id: 1 },
            5000,
          );

          await sleep(delayConfig.action);
        }

        if (result && result.error) {
          if (result.error.includes("俱乐部商品购买数量超出上限")) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 本周已购买过皮肤币，跳过`,
              type: "info",
            });
          } else if (result.error.includes("物品不存在")) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 盐锭不足或未加入军团，购买失败`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
          } else {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 购买失败: ${result.error}`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
          }
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 购买成功，获得皮肤币`,
            type: "success",
          });
          tokenStatus.value[tokenId] = "completed";
        }
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 购买过程出错: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 免费领取珍宝阁每日奖励
   */
  const collection_claimfreereward = async () => {
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
          message: `=== 开始免费领取珍宝阁: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送珍宝阁免费领取请求...`,
          type: "info",
        });

        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "collection_claimfreereward",
          {},
          5000,
        );

        await sleep(delayConfig.action);

        if (result.error) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 珍宝阁领取失败: ${result.error}`,
            type: "error",
          });
          tokenStatus.value[tokenId] = "failed";
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 珍宝阁领取成功`,
            type: "success",
          });
          tokenStatus.value[tokenId] = "completed";
        }
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 珍宝阁领取过程出错: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 一键配置黑市采购清单
   */
  const store_syncpurchaseconfig = async () => {
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
          message: `=== 开始配置黑市采购清单: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);
        await updateBlackMarketPurchaseConfig(tokenId, token.name);
        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 配置黑市采购清单失败: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 黑市一键采购
   */
  const store_purchase = async () => {
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
          message: `=== 开始黑市一键采购: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送黑市采购请求...`,
          type: "info",
        });

        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "store_purchase",
          {},
          5000,
        );

        await sleep(delayConfig.action);

        if (result.error) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 黑市采购失败: ${result.error}`,
            type: "error",
          });
          tokenStatus.value[tokenId] = "failed";
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 黑市采购成功`,
            type: "success",
          });
          tokenStatus.value[tokenId] = "completed";
        }
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 黑市采购过程出错: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 领取主页“十殿礼包”的第一个免费礼包
   */
  const activity_claimrolluppack = async () => {
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
          message: `=== 开始领取十殿免费礼包: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送十殿免费礼包领取请求...`,
          type: "info",
        });

        await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_claimrolluppack",
          { id: TEN_DAY_FREE_GIFT_ID },
          5000,
        );

        await sleep(delayConfig.action);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 十殿免费礼包领取完成`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        const errorText = String(error?.message || error);
        const alreadyClaimed = /12000116|1000020|700020|3500020/.test(
          errorText,
        );
        const possibleAlreadyClaimed = /200020/.test(errorText);
        addLog({
          time: new Date().toLocaleTimeString(),
          message: possibleAlreadyClaimed
            ? `${token.name} 十殿礼包可能已领取（服务器返回 200020），未重试`
            : alreadyClaimed
              ? `${token.name} 十殿免费礼包今日已领取`
              : `${token.name} 十殿礼包领取失败: ${error.message || error}`,
          type:
            possibleAlreadyClaimed || alreadyClaimed
              ? alreadyClaimed
                ? "info"
                : "warning"
              : "error",
        });
        tokenStatus.value[tokenId] =
          possibleAlreadyClaimed || alreadyClaimed ? "completed" : "failed";
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 领取当前周常“周活动 -> 限时商店”的第一个免费项。
   * 招募周、宝箱周已配置；江湖黑市周需抓包后补充协议。
   */
  const activity_buystoregoods = async () => {
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
          message: `=== 开始领取周常免费礼包: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 读取周常限时商店状态...`,
          type: "info",
        });

        const activityResponse = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_get",
          {},
          5000,
        );
        const weeklyState = detectWeeklyStoreState(activityResponse);
        if (!weeklyState.supported) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 当前周常商店协议尚未配置，跳过领取`,
            type: "info",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }
        if (!weeklyState.active) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 当前限时商店活动未开放，跳过领取`,
            type: "info",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }
        if (weeklyState.complete) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} ${weeklyState.label}限时商店本周已领取`,
            type: "info",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送${weeklyState.label}免费礼包领取请求...`,
          type: "info",
        });

        await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_buystoregoods",
          weeklyState.goods,
          5000,
        );

        await sleep(delayConfig.action);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} ${weeklyState.label}限时商店领取完成`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        const errorText = String(error?.message || error);
        const alreadyClaimed = /1100010|12000116|1000020|700020|7900023/.test(
          errorText,
        );
        addLog({
          time: new Date().toLocaleTimeString(),
          message: alreadyClaimed
            ? `${token.name} 周常免费礼包本周已领取`
            : `${token.name} 周常免费礼包领取失败: ${error.message || error}`,
          type: alreadyClaimed ? "warning" : "error",
        });
        tokenStatus.value[tokenId] = alreadyClaimed ? "completed" : "failed";
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  return {
    legion_storebuygoods,
    legionStoreBuySkinCoins,
    store_purchase,
    store_syncpurchaseconfig,
    collection_claimfreereward,
    activity_claimrolluppack,
    activity_buystoregoods,
  };
}
