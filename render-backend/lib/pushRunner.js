import { verifyTokenRoleIdentity } from "./roleIdentity.js";

const KNOWLEDGE_COIN_ITEM_ID = 1024;
const CONNECTION_RETRY_DELAYS_MS = [3_000, 5_000, 10_000, 20_000, 30_000];
const SETTLEMENT_RECONCILE_DELAYS_MS = [2_000, 3_000, 5_000];

function sleepWithSignal(sleep, ms, signal) {
  if (signal?.aborted) return Promise.reject(createAbortError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(createAbortError());
    signal?.addEventListener?.("abort", onAbort, { once: true });
    Promise.resolve(sleep(ms)).then(
      () => finish(),
      (error) => finish(error),
    );
  });
}

function createAbortError() {
  const error = new Error("推图已强制停止");
  error.code = "PUSH_FORCE_STOP";
  return error;
}

function createPushError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function responseBody(response) {
  if (response?.body && typeof response.body === "object") return response.body;
  if (response?._data && typeof response._data === "object") {
    return response._data;
  }
  return response || {};
}

function responseRole(response) {
  const body = responseBody(response);
  return body.role || body.body?.role || {};
}

function pickNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function readLevel(response) {
  const body = responseBody(response);
  const role = responseRole(response);
  return pickNumber(
    body.levelId,
    body.currLevel,
    body.nextLevel,
    body.body?.levelId,
    role.levelId,
    role.currLevel,
  );
}

function readBossName(response) {
  const body = responseBody(response);
  const role = responseRole(response);
  return String(body.bossName || body.body?.bossName || role.bossName || "");
}

function readTorch(response) {
  const body = responseBody(response);
  const role = responseRole(response);
  return {
    torchType: Math.max(
      0,
      pickNumber(role.autoClickType, body.autoClickType) || 0,
    ),
    torchRemaining: Math.max(
      0,
      pickNumber(role.autoClickTime, body.autoClickTime) || 0,
    ),
    torchSettleTime: Math.max(
      0,
      pickNumber(role.autoClickSettleTime, body.autoClickSettleTime) || 0,
    ),
  };
}

function readKnowledgeCoinCount(response) {
  const body = responseBody(response);
  const role = responseRole(response);
  const items = role.items || body.items || [];
  if (Array.isArray(items)) {
    const coin = items.find(
      (entry) => Number(entry.id ?? entry.itemId) === KNOWLEDGE_COIN_ITEM_ID,
    );
    return Math.max(0, Number(coin?.num ?? coin?.count ?? coin?.quantity ?? 0));
  }
  if (items && typeof items === "object") {
    return Math.max(
      0,
      Number(
        items[KNOWLEDGE_COIN_ITEM_ID]?.num ??
          items[KNOWLEDGE_COIN_ITEM_ID] ??
          0,
      ),
    );
  }
  return 0;
}

function isKickError(error) {
  return (
    Number(error?.code) === 200760 ||
    /界面已变化|重新登录|其他位置登录|顶号/.test(
      String(error?.message || error || ""),
    )
  );
}

function isConnectionError(error) {
  return /未连接|连接已关闭|连接超时|WebSocket|请求超时|socket/i.test(
    String(error?.message || error || ""),
  );
}

function isBattleVersionError(error) {
  return Number(error?.code) === 200750;
}

/**
 * Run one account for a bounded number of battles so the session manager can
 * rotate accounts through a concurrency slot without monopolising it forever.
 */
export class PushRunner {
  constructor({
    token,
    options,
    state,
    createClient,
    repairToken = null,
    onState = () => {},
    log = () => {},
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    shouldPause = () => false,
    onCheckpoint = () => {},
    maxBattles = 5,
    signal = null,
  }) {
    if (!token?.id) throw new Error("PushRunner requires token");
    if (typeof createClient !== "function") {
      throw new TypeError("PushRunner requires createClient");
    }
    this.token = token;
    this.options = options;
    this.state = state;
    this.createClient = createClient;
    this.repairToken = repairToken;
    this.onState = onState;
    this.log = log;
    this.sleep = sleep;
    this.now = now;
    this.shouldPause = shouldPause;
    this.onCheckpoint = onCheckpoint;
    this.maxBattles = Math.max(1, Math.trunc(Number(maxBattles) || 1));
    this.signal = signal;
    this.client = null;
    this.identity = null;
  }

  async run() {
    const roleResponse = await this._connectWithRetry();
    this._applyRoleInfo(roleResponse);
    await this._initializeBattleVersion();

    let completedBattles = 0;
    while (completedBattles < this.maxBattles) {
      this._throwIfStopped();
      if (this.shouldPause()) {
        return { reason: this._pauseReason(), battles: completedBattles };
      }

      const result = await this._runOneBattle();
      completedBattles += 1;
      this.state.retries = result.success ? 0 : this.state.retries;
      this.state.updatedAt = new Date(this.now()).toISOString();
      this.state.lastHeartbeatAt = this.state.updatedAt;
      this.onCheckpoint({ force: true });

      if (!result.success && this.state.retries >= this.options.maxRetries) {
        throw createPushError(
          "PUSH_RETRY_LIMIT",
          `连续失败 ${this.state.retries} 次，已达到配置上限`,
        );
      }
      if (!this.options.autoContinue) {
        this.state.status = "paused";
        this.onState({ force: true });
        return { reason: "auto-continue-disabled", battles: completedBattles };
      }
      if (this.shouldPause()) {
        return { reason: this._pauseReason(), battles: completedBattles };
      }

      const delay = result.success
        ? this.options.battleIntervalSeconds * 1000
        : this.options.retryDelaySeconds * 1000;
      await sleepWithSignal(this.sleep, delay, this.signal);
    }

    return { reason: "batch-complete", battles: completedBattles };
  }

  disconnect() {
    this.client?.disconnect?.();
  }

  _pauseReason() {
    return this.shouldPause() || "session-pause";
  }

  _throwIfStopped() {
    if (this.signal?.aborted) throw createAbortError();
  }

  _applyRoleInfo(response) {
    const level = readLevel(response);
    if (level != null && level > 0) this.state.level = level;
    const bossName = readBossName(response);
    if (bossName) this.state.bossName = bossName;
    Object.assign(this.state, readTorch(response));
  }

  async _connectWithRetry() {
    this.state.status = "connecting";
    this.onState();
    let lastError = null;
    for (
      let attempt = 0;
      attempt <= CONNECTION_RETRY_DELAYS_MS.length;
      attempt += 1
    ) {
      this._throwIfStopped();
      if (attempt > 0) {
        const delay =
          CONNECTION_RETRY_DELAYS_MS[
            Math.min(attempt - 1, CONNECTION_RETRY_DELAYS_MS.length - 1)
          ];
        await sleepWithSignal(this.sleep, delay, this.signal);
      }
      try {
        return await this._openClient();
      } catch (error) {
        if (this.signal?.aborted) throw createAbortError();
        if (isKickError(error)) {
          this.client?.disconnect?.();
          this.client = null;
          throw createPushError("PUSH_ACCOUNT_KICKED", error.message, {
            cause: error,
          });
        }
        this.client?.disconnect?.();
        this.client = null;
        lastError = error;
        this.state.lastError = String(error.message || error);
        this.state.consecutiveErrors += 1;
        this.onState();
        this.log(
          `连接或身份校验失败，第 ${attempt + 1} 次：${this.state.lastError}`,
          "warning",
        );
      } finally {
        if (this.client?.connected === false) {
          this.client.disconnect?.();
          this.client = null;
        }
      }
    }
    throw createPushError(
      "PUSH_CONNECTION_FAILED",
      `连接重试耗尽：${lastError?.message || "未知错误"}`,
    );
  }

  async _openClient() {
    this.client?.disconnect?.();
    this.client = this.createClient(this.token);
    await this.client.connect(15_000);
    let response = await this.client.sendWithPromise(
      "role_getroleinfo",
      {},
      12_000,
    );
    try {
      this.identity = verifyTokenRoleIdentity(this.token, response);
    } catch (error) {
      if (!error.roleIdentityMismatch || !this.repairToken) throw error;
      this.log("角色身份异常，正在使用 NAS BIN 自动修复", "warning");
      this.client.disconnect();
      this.client = null;
      this.token = await this.repairToken(this.token);
      this.client = this.createClient(this.token);
      await this.client.connect(15_000);
      response = await this.client.sendWithPromise(
        "role_getroleinfo",
        {},
        12_000,
      );
      this.identity = verifyTokenRoleIdentity(this.token, response);
    }
    return response;
  }

  async _initializeBattleVersion() {
    this._throwIfStopped();
    if (typeof this.client.ensureBattleVersion === "function") {
      this.state.battleVersion = await this.client.ensureBattleVersion();
    } else {
      const response = await this.client.sendWithPromise(
        "fight_startlevel",
        {},
        10_000,
      );
      this.state.battleVersion =
        responseBody(response).battleData?.version ?? null;
    }
    this.state.status = "idle";
    this.onState({ force: true });
  }

  async _runOneBattle() {
    this._throwIfStopped();
    const battleTime = await this._calculateBattleTime();
    this.state.status = "fighting";
    this.state.battleTime = battleTime;
    this.state.battleStartedAt = new Date(this.now()).toISOString();
    this.state.battles += 1;
    this.onState({ force: true });
    this.log(`开始第 ${this.state.level} 关，预计 ${battleTime} 秒`, "info");

    if (this.options.autoUpgradeHangup && this.state.level % 100 === 1) {
      await this._upgradeHangup();
    }

    await this._waitForBattle(battleTime);
    this._throwIfStopped();
    this.state.status = "settling";
    this.onState({ force: true });
    return this._settleBattle();
  }

  async _calculateBattleTime() {
    this.state.status = "calculating";
    this.onState();
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      this._throwIfStopped();
      try {
        const response = await this.client.sendWithPromise(
          "fight_calcleveltime",
          {},
          15_000,
        );
        const body = responseBody(response);
        const level = readLevel(response);
        if (level != null && level > 0) this.state.level = level;
        const bossName = readBossName(response);
        if (bossName) this.state.bossName = bossName;
        const battleTime = Math.max(
          0,
          Number(body.battleTime ?? body.body?.battleTime) || 0,
        );
        if (battleTime <= 0) {
          throw new Error("服务器未返回有效战斗时间");
        }
        if (battleTime > this.options.battleTimeCapSeconds) {
          throw createPushError(
            "PUSH_BATTLE_TIME_INVALID",
            `战斗倒计时 ${battleTime} 秒超过上限 ${this.options.battleTimeCapSeconds} 秒`,
          );
        }
        this.state.lastError = "";
        return battleTime;
      } catch (error) {
        if (isKickError(error)) {
          throw createPushError("PUSH_ACCOUNT_KICKED", error.message, {
            cause: error,
            settlementUnknown: true,
          });
        }
        if (
          error.code === "PUSH_BATTLE_TIME_INVALID" ||
          error.code === "PUSH_FORCE_STOP"
        ) {
          throw error;
        }
        lastError = error;
        this.state.retries += 1;
        this.state.lastError = String(error.message || error);
        this.log(
          `计算战斗时间失败，第 ${attempt + 1} 次：${this.state.lastError}`,
          "warning",
        );
        if (isConnectionError(error) && attempt < 2) {
          await this._reconnect();
        } else if (attempt < 2) {
          await sleepWithSignal(
            this.sleep,
            this.options.retryDelaySeconds * 1000,
            this.signal,
          );
        }
      }
    }
    throw createPushError(
      "PUSH_CALCULATE_FAILED",
      `无法取得战斗时间：${lastError?.message || "未知错误"}`,
    );
  }

  async _waitForBattle(battleTime) {
    const startedAt = this.now();
    let remaining = battleTime;
    while (remaining > 0) {
      this._throwIfStopped();
      await sleepWithSignal(this.sleep, 1000, this.signal);
      remaining = Math.max(
        0,
        Math.ceil((battleTime * 1000 - (this.now() - startedAt)) / 1000),
      );
      this.state.battleTime = remaining;
      this.state.lastHeartbeatAt = new Date(this.now()).toISOString();
      this.state.updatedAt = this.state.lastHeartbeatAt;
      this.onState();
    }
    this.state.battleTime = 0;
  }

  async _settleBattle() {
    const beforeLevel = this.state.level;
    try {
      const response = await this.client.sendWithPromise(
        "fight_level",
        {},
        15_000,
      );
      return this._applySettlementResponse(response, beforeLevel);
    } catch (error) {
      if (this.signal?.aborted) throw createAbortError();
      if (isKickError(error)) {
        throw createPushError("PUSH_ACCOUNT_KICKED", error.message, {
          cause: error,
          settlementUnknown: true,
        });
      }
      if (isBattleVersionError(error)) {
        this.client.battleVersion = null;
        try {
          await this.client.ensureBattleVersion?.();
        } catch (refreshError) {
          this.log(`重新获取战斗版本失败：${refreshError.message}`, "warning");
        }
      } else if (!isConnectionError(error) && !isBattleVersionError(error)) {
        return this._recordLoss(error);
      }
      return this._reconcileSettlement(beforeLevel, error);
    }
  }

  _applySettlementResponse(response, beforeLevel) {
    const body = responseBody(response);
    const success = Boolean(body.success || body.isWin);
    const nextLevel = readLevel(response);
    const bossName = readBossName(response);
    if (success) return this._recordWin(nextLevel, bossName);
    if (Object.hasOwn(body, "success") || Object.hasOwn(body, "isWin")) {
      return this._recordLoss(body.msg || body.message || "服务器判定失败");
    }
    if (nextLevel != null && nextLevel > beforeLevel) {
      return this._recordWin(nextLevel, bossName);
    }
    throw createPushError(
      "PUSH_SETTLEMENT_UNKNOWN",
      "战斗结算响应没有明确结果",
    );
  }

  _recordWin(nextLevel, bossName = "") {
    const previous = this.state.level;
    this.state.wins += 1;
    this.state.retries = 0;
    this.state.consecutiveErrors = 0;
    this.state.level = Math.max(
      previous + 1,
      Number(nextLevel) || previous + 1,
    );
    if (bossName) this.state.bossName = bossName;
    this.state.lastSettlementAt = new Date(this.now()).toISOString();
    this.state.status = "idle";
    this.state.lastError = "";
    this.onState({ force: true });
    this.log(`胜利，当前关卡 ${this.state.level}`, "success");
    return { success: true };
  }

  _recordLoss(message) {
    this.state.losses += 1;
    this.state.retries += 1;
    this.state.lastSettlementAt = new Date(this.now()).toISOString();
    this.state.lastError = String(message || "战斗失败");
    this.state.status = "idle";
    this.onState({ force: true });
    this.log(
      `战斗失败，连续失败 ${this.state.retries} 次：${this.state.lastError}`,
      "warning",
    );
    return { success: false, error: this.state.lastError };
  }

  async _reconcileSettlement(beforeLevel, originalError) {
    this.log(
      `结算结果未知，先读取真实关卡，不重复发送 fight_level：${originalError.message}`,
      "warning",
    );
    let lastError = originalError;
    for (let attempt = 0; attempt < SETTLEMENT_RECONCILE_DELAYS_MS.length;) {
      await sleepWithSignal(
        this.sleep,
        SETTLEMENT_RECONCILE_DELAYS_MS[attempt],
        this.signal,
      );
      attempt += 1;
      this._throwIfStopped();
      try {
        if (!this.client?.connected) await this._reconnect();
        const response = await this.client.sendWithPromise(
          "role_getroleinfo",
          {},
          10_000,
        );
        this._applyRoleInfo(response);
        if (this.state.level > beforeLevel) {
          this.log(
            `读取到关卡从 ${beforeLevel} 推进到 ${this.state.level}，按胜利结算`,
            "success",
          );
          this.state.wins += 1;
          this.state.retries = 0;
          this.state.consecutiveErrors = 0;
          this.state.lastSettlementAt = new Date(this.now()).toISOString();
          this.state.status = "idle";
          this.state.lastError = "";
          this.onState({ force: true });
          return { success: true };
        }
      } catch (error) {
        lastError = error;
        if (isKickError(error)) {
          throw createPushError("PUSH_ACCOUNT_KICKED", error.message, {
            cause: error,
            settlementUnknown: true,
          });
        }
        this.log(`核对战斗结果失败：${error.message}`, "warning");
      }
    }
    this.state.lastError = `结算结果未知：${lastError?.message || "无法确认"}`;
    this.state.status = "paused";
    this.state.retries += 1;
    this.onState({ force: true });
    throw createPushError("PUSH_SETTLEMENT_UNKNOWN", this.state.lastError);
  }

  async _reconnect() {
    this.client?.disconnect?.();
    this.client = this.createClient(this.token);
    await this.client.connect(15_000);
    const response = await this.client.sendWithPromise(
      "role_getroleinfo",
      {},
      12_000,
    );
    this.identity = verifyTokenRoleIdentity(this.token, response);
    this._applyRoleInfo(response);
    if (typeof this.client.ensureBattleVersion === "function") {
      await this.client.ensureBattleVersion();
    }
  }

  async _upgradeHangup() {
    let roleInfo;
    try {
      roleInfo = await this.client.sendWithPromise(
        "role_getroleinfo",
        {},
        10_000,
      );
    } catch (error) {
      this.log(`读取知识币失败：${error.message}`, "warning");
      return;
    }
    let coinCount = readKnowledgeCoinCount(roleInfo);
    if (coinCount <= 0) {
      this.log("知识币不足，跳过升级挂机奖励", "info");
      return;
    }
    let used = 0;
    while (coinCount > 0) {
      this._throwIfStopped();
      const upgradeNum = coinCount >= 50 ? 50 : coinCount >= 10 ? 10 : 1;
      try {
        await this.client.sendWithPromise(
          "system_hangupupgrade",
          { upgradeNum },
          8_000,
        );
        coinCount -= upgradeNum;
        used += upgradeNum;
      } catch (error) {
        this.log(`升级挂机失败：${error.message}`, "warning");
        break;
      }
      await sleepWithSignal(this.sleep, 1200, this.signal);
    }
    if (used > 0) {
      this.log(`升级挂机奖励完成，共用 ${used} 个知识币`, "success");
    }
  }
}

export function isPushKickError(error) {
  return error?.code === "PUSH_ACCOUNT_KICKED" || isKickError(error);
}

export function isPushConnectionError(error) {
  return isConnectionError(error);
}
