import { randomUUID } from "node:crypto";
import { isPushKickError, PushRunner } from "./pushRunner.js";
import {
  createPushRunState,
  isActivePushStatus,
  isTerminalPushStatus,
  normalizePushRunState,
} from "./pushState.js";
import {
  findDuplicateExpectedRoles,
  verifyTokenRoleIdentity,
} from "./roleIdentity.js";
import { tokenNeedsRefresh } from "./tokenRefresh.js";

const ACCOUNT_BATCH_SIZE = 5;
const PERSIST_INTERVAL_MS = 5_000;
const IDLE_POLL_MS = 750;
const TASK_WAIT_POLL_MS = 1_000;

function abortError(message = "推图会话已停止") {
  const error = new Error(message);
  error.name = "AbortError";
  error.code = "PUSH_FORCE_STOP";
  return error;
}

function abortableSleep(sleep, ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(abortError());
    signal?.addEventListener?.("abort", onAbort, { once: true });
    Promise.resolve(sleep(ms)).then(
      () => finish(),
      (error) => finish(error),
    );
  });
}

function normalizeType(type) {
  if (type === "warn") return "warning";
  if (["info", "success", "warning", "error"].includes(type)) return type;
  return "info";
}

function publicRuntimeState(record) {
  return normalizePushRunState(record.state);
}

export class PushSessionManager {
  constructor({
    dataStore,
    lockQueue,
    tokenRefreshManager,
    createClient,
    repairToken = null,
    log = null,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    accountBatchSize = ACCOUNT_BATCH_SIZE,
  }) {
    if (!dataStore) throw new Error("PushSessionManager requires dataStore");
    if (!lockQueue) throw new Error("PushSessionManager requires lockQueue");
    if (typeof createClient !== "function") {
      throw new TypeError("PushSessionManager requires createClient");
    }
    this.dataStore = dataStore;
    this.lockQueue = lockQueue;
    this.tokenRefreshManager = tokenRefreshManager;
    this.createClient = createClient;
    this.repairToken = repairToken;
    this.log = log;
    this.now = now;
    this.sleep = sleep;
    this.accountBatchSize = Math.max(
      1,
      Math.trunc(Number(accountBatchSize) || ACCOUNT_BATCH_SIZE),
    );
    this.records = new Map();
    this.refreshChain = Promise.resolve();
  }

  async restore() {
    const states = (await this.dataStore.listPushingRunStates?.()) || {};
    const restored = [];
    for (const raw of Object.values(states)) {
      const state = normalizePushRunState(raw);
      if (!state.runId) continue;
      const shouldResume = !isTerminalPushStatus(state.status);
      if (shouldResume) {
        state.status = "queued";
        state.stopRequested = false;
        state.pauseReason = "";
        for (const account of Object.values(state.accounts)) {
          if (
            !["paused", "failed", "waiting-relogin"].includes(account.status)
          ) {
            account.status = "queued";
          }
          account.battleTime = 0;
          account.battleStartedAt = null;
        }
      }
      const record = this._createRecord(state);
      this.records.set(state.runId, record);
      if (!shouldResume) continue;
      await this._persist(record, true);
      this._launch(record);
      restored.push(publicRuntimeState(record));
      await this._log(record, {
        level: "info",
        taskType: "pushingSession",
        message: "NAS 重启后已恢复未停止的推图会话",
      });
    }
    return restored;
  }

  async start({ tokenIds = [], options = {}, requestedBy = "nas-manual" }) {
    const ids = [...new Set(tokenIds.map(String).filter(Boolean))];
    if (ids.length === 0) throw new Error("至少选择一个账号");
    const tokens = await this.dataStore.listTokens({ enabledOnly: true });
    const byId = new Map(tokens.map((token) => [String(token.id), token]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new Error(`账号不存在或已停用：${missing.join(", ")}`);
    }
    const duplicateRoles = findDuplicateExpectedRoles(
      ids.map((tokenId) => byId.get(tokenId)),
    );
    if (duplicateRoles.length > 0) {
      throw new Error(
        duplicateRoles
          .map(
            ({ roleId, tokens: duplicates }) =>
              `角色 ${roleId} 重复：${duplicates
                .map((token) => token.name)
                .join("、")}`,
          )
          .join("；"),
      );
    }
    const activeRun = [...this.records.values()].find((record) =>
      isActivePushStatus(record.state.status),
    );
    if (activeRun) {
      throw new Error(
        `已有活动推图会话 ${activeRun.state.runId}，请先停止后再启动新会话`,
      );
    }

    const runId = randomUUID();
    const accounts = Object.fromEntries(
      ids.map((tokenId) => [
        tokenId,
        {
          tokenId,
          tokenName: byId.get(tokenId)?.name || tokenId,
        },
      ]),
    );
    const state = createPushRunState({
      runId,
      tokenIds: ids,
      accounts,
      options,
      requestedBy,
      now: new Date(this.now()).toISOString(),
    });
    const record = this._createRecord(state);
    this.records.set(runId, record);
    await this._persist(record, true);
    await this._log(record, {
      level: "info",
      taskType: "pushingSession",
      message: `创建 NAS 推图会话，共 ${ids.length} 个账号，最大并发 ${state.options.maxConcurrent}`,
    });
    this._launch(record);
    return publicRuntimeState(record);
  }

  list() {
    return [...this.records.values()]
      .map(publicRuntimeState)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  status() {
    const runs = this.list();
    return {
      runs,
      activeRun: runs.find((run) => isActivePushStatus(run.status)) || null,
      accountLocks: this.lockQueue.snapshot(),
      accountWaiters: this.lockQueue.waitingSnapshot?.() || {},
    };
  }

  get(runId) {
    const record = this.records.get(String(runId));
    return record ? publicRuntimeState(record) : null;
  }

  async checkpoint() {
    await Promise.all(
      [...this.records.values()]
        .filter((record) => isActivePushStatus(record.state.status))
        .map((record) => this._persist(record, true)),
    );
  }

  async stop(runId, reason = "用户手动停止") {
    const record = this._requireRecord(runId);
    if (isTerminalPushStatus(record.state.status)) {
      return publicRuntimeState(record);
    }
    record.runtime.stopRequested = true;
    record.runtime.pauseReasons.clear();
    record.state.stopRequested = true;
    record.state.stopReason = String(reason || "用户手动停止");
    record.state.status = "stopping";
    record.runtime.controller?.abort(abortError());
    for (const runner of record.runtime.runners.values()) {
      try {
        runner.disconnect?.();
      } catch {
        // Force stop is best effort.
      }
    }
    this._releaseAllLeases(record);
    for (const account of Object.values(record.state.accounts)) {
      if (account.status !== "failed") account.status = "stopped";
      account.battleTime = 0;
    }
    record.state.status = "stopped";
    record.state.stoppedAt = new Date(this.now()).toISOString();
    record.state.pauseReason = "";
    await this._persist(record, true);
    await this._log(record, {
      level: "warning",
      taskType: "pushingSession",
      message: `推图会话已强制停止：${record.state.stopReason}`,
    });
    return publicRuntimeState(record);
  }

  async requestTorch(
    runId,
    { tokenIds = [], itemId = 1008, quantity = 1 } = {},
  ) {
    const record = this._requireRecord(runId);
    if (
      !["running", "waiting-scheduled-task", "waiting-manual-torch"].includes(
        record.state.status,
      )
    ) {
      throw new Error("推图会话当前未运行");
    }
    const ids = [...new Set(tokenIds.map(String).filter(Boolean))];
    const allowed = new Set(record.state.tokenIds);
    const invalid = ids.filter((tokenId) => !allowed.has(tokenId));
    if (ids.length === 0 || invalid.length > 0) {
      throw new Error(
        `使用火把账号不属于当前推图会话：${invalid.join("、") || "无"}`,
      );
    }
    if (record.runtime.pendingTorch) {
      throw new Error("当前已有火把操作正在排队");
    }
    record.runtime.pendingTorch = {
      tokenIds: ids,
      itemId: Math.max(1, Math.trunc(Number(itemId) || 1008)),
      quantity: Math.max(1, Math.trunc(Number(quantity) || 1)),
    };
    this._requestPause(record, "manual-torch", {
      tokenIds: ids,
      itemId,
      quantity,
    });
    return { status: "queued", runId: record.state.runId };
  }

  _createRecord(state) {
    return {
      state: normalizePushRunState(state),
      runtime: {
        controller: null,
        runPromise: null,
        saveTimer: null,
        persistChain: Promise.resolve(),
        leases: new Map(),
        runners: new Map(),
        claimedAccounts: new Set(),
        pauseReasons: new Set(),
        pendingTorch: null,
        stopRequested: false,
        finalized: false,
      },
    };
  }

  _launch(record) {
    if (record.runtime.runPromise) return record.runtime.runPromise;
    record.runtime.controller = new AbortController();
    record.runtime.runPromise = this._run(record)
      .catch(async (error) => {
        if (record.runtime.stopRequested || error?.code === "PUSH_FORCE_STOP") {
          return;
        }
        record.state.status = "failed";
        record.state.pauseReason = "";
        record.state.stopReason = String(error?.message || error);
        record.state.stoppedAt = new Date(this.now()).toISOString();
        await this._persist(record, true);
        await this._log(record, {
          level: "error",
          taskType: "pushingSession",
          message: `推图会话异常结束：${record.state.stopReason}`,
        });
      })
      .finally(async () => {
        this._releaseAllLeases(record);
      });
    return record.runtime.runPromise;
  }

  async _run(record) {
    record.state.status = "running";
    record.state.startedAt =
      record.state.startedAt || new Date(this.now()).toISOString();
    await this._persist(record, true);

    while (!record.runtime.stopRequested) {
      const leasesReady = await this._ensureRequiredLeases(record);
      if (!leasesReady && !record.runtime.stopRequested) {
        this._releaseAllLeases(record);
        if (record.runtime.pauseReasons.has("scheduled-task")) {
          await this._waitForScheduledTasks(record);
          record.runtime.pauseReasons.delete("scheduled-task");
          record.state.pauseReason = "";
          continue;
        }
        if (record.runtime.pauseReasons.has("manual-torch")) {
          await this._performPendingTorch(record);
          record.runtime.pauseReasons.delete("manual-torch");
          record.state.pauseReason = "";
          continue;
        }
        await abortableSleep(
          this.sleep,
          TASK_WAIT_POLL_MS,
          record.runtime.controller.signal,
        );
        continue;
      }
      const outcome = await this._runWorkerPool(record);
      this._releaseAllLeases(record);
      if (record.runtime.stopRequested) break;

      if (record.runtime.pauseReasons.has("scheduled-task")) {
        await this._waitForScheduledTasks(record);
        record.runtime.pauseReasons.delete("scheduled-task");
        record.state.pauseReason = "";
        record.state.status = "running";
        await this._persist(record, true);
        continue;
      }

      if (record.runtime.pauseReasons.has("manual-torch")) {
        await this._performPendingTorch(record);
        record.runtime.pauseReasons.delete("manual-torch");
        record.state.pauseReason = "";
        record.state.status = "running";
        await this._persist(record, true);
        continue;
      }

      if (outcome.exhausted) {
        record.state.status = "paused";
        record.state.pauseReason = "所有账号均已暂停";
        await this._persist(record, true);
        await this._log(record, {
          level: "warning",
          taskType: "pushingSession",
          message: "所有账号均已暂停，推图会话保留状态等待人工处理",
        });
        break;
      }
    }
  }

  async _ensureRequiredLeases(record) {
    const tokenIds = this._leaseCandidateTokenIds(record);
    for (const tokenId of tokenIds) {
      if (record.runtime.stopRequested) return false;
      if (record.runtime.leases.has(tokenId)) continue;
      if (
        this.lockQueue.isLocked(tokenId) ||
        this.lockQueue.hasWaitingTask(tokenId)
      ) {
        this._requestPause(record, "scheduled-task", { tokenId });
        return false;
      }
      try {
        await this.lockQueue.acquire(tokenId, record.state.taskId, {
          signal: record.runtime.controller.signal,
          onWait: (holderTaskId) => {
            this._requestPause(record, "scheduled-task", {
              tokenId,
              holderTaskId,
            });
          },
        });
        record.runtime.leases.set(tokenId, true);
      } catch (error) {
        if (record.runtime.stopRequested || error?.name === "AbortError") {
          return false;
        }
        throw error;
      }
    }
    return true;
  }

  _leaseCandidateTokenIds(record) {
    const current = this.now();
    return record.state.tokenIds.filter((tokenId) => {
      const account = record.state.accounts[tokenId];
      if (
        !account ||
        ["paused", "failed", "stopped"].includes(account.status)
      ) {
        return false;
      }
      if (account.status === "waiting-relogin") {
        const due = new Date(account.reloginAt || 0).getTime();
        return Number.isFinite(due) && due <= current;
      }
      return true;
    });
  }

  async _runWorkerPool(record) {
    const workerCount = Math.min(
      record.state.options.maxConcurrent,
      record.state.tokenIds.length,
    );
    const workers = Array.from({ length: workerCount }, async (_, index) => {
      if (index > 0) {
        await abortableSleep(
          this.sleep,
          index * 2_000,
          record.runtime.controller.signal,
        );
      }
      return this._workerLoop(record);
    });
    const results = await Promise.all(workers);
    return {
      exhausted:
        results.every(Boolean) && record.runtime.pauseReasons.size === 0,
    };
  }

  async _workerLoop(record) {
    while (!record.runtime.stopRequested) {
      if (this._detectScheduledWait(record)) return false;
      if (this._currentPauseReason(record)) return false;
      const account = await this._claimAccount(record);
      if (!account) {
        if (!this._hasPotentialAccount(record)) return true;
        try {
          await abortableSleep(
            this.sleep,
            IDLE_POLL_MS,
            record.runtime.controller.signal,
          );
        } catch {
          return false;
        }
        continue;
      }

      try {
        await this._runAccountJob(record, account);
      } finally {
        record.runtime.claimedAccounts.delete(account.tokenId);
      }
    }
    return false;
  }

  async _claimAccount(record) {
    if (this._currentPauseReason(record)) return null;
    const current = this.now();
    const candidates = record.state.tokenIds
      .map((tokenId) => record.state.accounts[tokenId])
      .filter((account) => {
        if (!account || record.runtime.claimedAccounts.has(account.tokenId)) {
          return false;
        }
        if (["paused", "failed", "stopped"].includes(account.status)) {
          return false;
        }
        if (
          account.status === "waiting-relogin" &&
          new Date(account.reloginAt || 0).getTime() > current
        ) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        const leftAt = left.lastRunAt ? new Date(left.lastRunAt).getTime() : 0;
        const rightAt = right.lastRunAt
          ? new Date(right.lastRunAt).getTime()
          : 0;
        return leftAt - rightAt || left.tokenId.localeCompare(right.tokenId);
      });
    const account = candidates[0];
    if (!account) return null;
    record.runtime.claimedAccounts.add(account.tokenId);
    try {
      if (!record.runtime.leases.has(account.tokenId)) {
        if (
          this.lockQueue.isLocked(account.tokenId) ||
          this.lockQueue.hasWaitingTask(account.tokenId)
        ) {
          this._requestPause(record, "scheduled-task", {
            tokenId: account.tokenId,
          });
          return null;
        }
        await this.lockQueue.acquire(account.tokenId, record.state.taskId, {
          signal: record.runtime.controller.signal,
          onWait: (holderTaskId) => {
            this._requestPause(record, "scheduled-task", {
              tokenId: account.tokenId,
              holderTaskId,
            });
          },
        });
        record.runtime.leases.set(account.tokenId, true);
      }
      return account;
    } catch (error) {
      if (record.runtime.stopRequested || error?.name === "AbortError") {
        return null;
      }
      throw error;
    } finally {
      if (
        record.runtime.pauseReasons.size > 0 ||
        record.runtime.stopRequested
      ) {
        record.runtime.claimedAccounts.delete(account.tokenId);
      }
    }
  }

  async _runAccountJob(record, account) {
    const tokenId = account.tokenId;
    if (record.runtime.stopRequested) return;
    await this._refreshToken(tokenId);
    let token = await this.dataStore.getToken(tokenId);
    if (!token?.enabled) {
      this._setAccountPaused(record, account, "账号不存在或已停用");
      return;
    }
    if (
      this.tokenRefreshManager &&
      tokenNeedsRefresh(token, this.now()) &&
      !(await this.dataStore.getTokenRefreshCredential?.(tokenId))?.bin
    ) {
      this._setAccountPaused(record, account, "缺少 BIN 自动刷新凭据");
      return;
    }

    account.status = "connecting";
    account.updatedAt = new Date(this.now()).toISOString();
    account.lastRunAt = account.updatedAt;
    this._schedulePersist(record);
    const runner = new PushRunner({
      token,
      options: record.state.options,
      state: account,
      createClient: this.createClient,
      repairToken: this.repairToken
        ? async (currentToken) => {
            const repaired = await this.repairToken(currentToken);
            token = repaired;
            return repaired;
          }
        : null,
      onState: ({ force = false } = {}) => {
        account.updatedAt = new Date(this.now()).toISOString();
        this._schedulePersist(record, force);
      },
      onCheckpoint: ({ force = false } = {}) => {
        this._schedulePersist(record, force);
      },
      log: (message, type = "info") => {
        void this._log(record, {
          level: normalizeType(type),
          taskType: type === "success" ? "pushingBattle" : "pushingAccount",
          tokenId,
          tokenName: account.tokenName,
          message,
        });
      },
      shouldPause: () => this._detectScheduledWait(record),
      signal: record.runtime.controller.signal,
      sleep: this.sleep,
      now: this.now,
      maxBattles: this.accountBatchSize,
    });
    record.runtime.runners.set(tokenId, runner);
    try {
      const result = await runner.run();
      if (result.reason === "auto-continue-disabled") {
        this._releaseLease(record, tokenId);
        account.status = "paused";
        account.lastError = "自动继续已关闭";
        this._schedulePersist(record, true);
        await this._log(record, {
          level: "warning",
          taskType: "pushingAccount",
          tokenId,
          tokenName: account.tokenName,
          message: "自动继续已关闭，本账号保留当前关卡并暂停",
        });
        return;
      }
      account.status = "idle";
      account.lastRunAt = new Date(this.now()).toISOString();
      account.lastError = "";
      this._schedulePersist(record, true);
      await this._log(record, {
        level: "info",
        taskType: "pushingAccount",
        tokenId,
        tokenName: account.tokenName,
        message: `本轮推进 ${result.battles} 场，切换并发槽位继续调度`,
      });
    } catch (error) {
      if (
        record.runtime.stopRequested ||
        error?.code === "PUSH_FORCE_STOP" ||
        error?.name === "AbortError"
      ) {
        return;
      }
      if (isPushKickError(error)) {
        this._releaseLease(record, tokenId);
        const kickedAt = new Date(this.now()).toISOString();
        const reloginAt = new Date(
          this.now() + record.state.options.kickReloginDelayMinutes * 60 * 1000,
        ).toISOString();
        account.status = "waiting-relogin";
        account.kickedAt = kickedAt;
        account.reloginAt = reloginAt;
        account.kickCount += 1;
        account.lastError =
          error.message ||
          (error.settlementUnknown ? "被顶号，结算结果未知" : "账号被顶号");
        this._schedulePersist(record, true);
        await this._log(record, {
          level: "warning",
          taskType: "pushingRelogin",
          tokenId,
          tokenName: account.tokenName,
          message: `账号被顶号，将在 ${record.state.options.kickReloginDelayMinutes} 分钟后重新登录；累计 ${account.kickCount} 次`,
        });
        return;
      }
      this._releaseLease(record, tokenId);
      account.status = "paused";
      account.lastError = String(error.message || error);
      this._schedulePersist(record, true);
      await this._log(record, {
        level: "error",
        taskType: "pushingAccount",
        tokenId,
        tokenName: account.tokenName,
        message: `账号推图暂停：${account.lastError}`,
      });
    } finally {
      runner.disconnect();
      record.runtime.runners.delete(tokenId);
    }
  }

  _setAccountPaused(record, account, message) {
    account.status = "paused";
    account.lastError = message;
    this._releaseLease(record, account.tokenId);
    this._schedulePersist(record, true);
    void this._log(record, {
      level: "error",
      taskType: "pushingAccount",
      tokenId: account.tokenId,
      tokenName: account.tokenName,
      message: `账号推图暂停：${message}`,
    });
  }

  _refreshToken(tokenId) {
    this.refreshChain = this.refreshChain
      .catch(() => {})
      .then(() => this.tokenRefreshManager?.run?.({ tokenIds: [tokenId] }));
    return this.refreshChain;
  }

  _hasPotentialAccount(record) {
    const current = this.now();
    return record.state.tokenIds.some((tokenId) => {
      const account = record.state.accounts[tokenId];
      if (
        !account ||
        ["paused", "failed", "stopped"].includes(account.status)
      ) {
        return false;
      }
      if (account.status === "waiting-relogin") {
        return new Date(account.reloginAt || 0).getTime() > current;
      }
      return true;
    });
  }

  _detectScheduledWait(record) {
    if (record.runtime.stopRequested) return "session-stopped";
    if (record.runtime.pauseReasons.has("manual-torch")) return "manual-torch";
    for (const tokenId of record.state.tokenIds) {
      if (this.lockQueue.hasWaitingTask(tokenId)) {
        this._requestPause(record, "scheduled-task", { tokenId });
        return "scheduled-task";
      }
    }
    return null;
  }

  _requestPause(record, reason, detail = {}) {
    if (record.runtime.stopRequested) return;
    if (record.runtime.pauseReasons.has(reason)) return;
    record.runtime.pauseReasons.add(reason);
    record.state.pauseReason = reason;
    record.state.status =
      reason === "manual-torch"
        ? "waiting-manual-torch"
        : "waiting-scheduled-task";
    this._schedulePersist(record, true);
    void this._log(record, {
      level: "info",
      taskType: reason === "manual-torch" ? "pushingTorch" : "pushingLock",
      message:
        reason === "manual-torch"
          ? "收到手动火把请求，正在等待当前战斗结算后暂停整个会话"
          : `检测到自动任务等待推图账号 ${detail.tokenId || ""}，正在等待当前战斗结算后释放账号锁`,
    });
  }

  _currentPauseReason(record) {
    if (record.runtime.pauseReasons.has("scheduled-task")) {
      return "scheduled-task";
    }
    if (record.runtime.pauseReasons.has("manual-torch")) return "manual-torch";
    return null;
  }

  async _waitForScheduledTasks(record) {
    record.state.status = "waiting-scheduled-task";
    record.state.pauseReason = "scheduled-task";
    for (const account of Object.values(record.state.accounts)) {
      if (
        ["idle", "connecting", "calculating", "fighting", "settling"].includes(
          account.status,
        )
      ) {
        account.status = "waiting-scheduled-task";
      }
    }
    await this._persist(record, true);
    await this._log(record, {
      level: "info",
      taskType: "pushingLock",
      message: "推图会话已释放全部账号锁，等待自动任务结束",
    });

    while (!record.runtime.stopRequested) {
      const busy = record.state.tokenIds.some(
        (tokenId) =>
          this.lockQueue.hasWaitingTask(tokenId) ||
          this.lockQueue.isLocked(tokenId),
      );
      if (!busy) break;
      await abortableSleep(
        this.sleep,
        TASK_WAIT_POLL_MS,
        record.runtime.controller.signal,
      );
    }
    if (record.runtime.stopRequested) return;
    for (const account of Object.values(record.state.accounts)) {
      if (account.status === "waiting-scheduled-task")
        account.status = "queued";
    }
    await this._log(record, {
      level: "success",
      taskType: "pushingLock",
      message: "自动任务已全部结束，推图会话重新获取账号锁并恢复",
    });
  }

  async _performPendingTorch(record) {
    const request = record.runtime.pendingTorch;
    if (!request) return;
    record.state.status = "waiting-manual-torch";
    record.state.pauseReason = "manual-torch";
    await this._persist(record, true);
    await this._log(record, {
      level: "info",
      taskType: "pushingTorch",
      message: `推图已暂停，开始为 ${request.tokenIds.length} 个账号手动使用火把`,
    });
    const results = [];
    for (const tokenId of request.tokenIds) {
      if (record.runtime.stopRequested) break;
      try {
        await this._refreshToken(tokenId);
        const token = await this.dataStore.getToken(tokenId);
        if (!token?.enabled) throw new Error("账号不存在或已停用");
        if (
          this.lockQueue.isLocked(tokenId) ||
          this.lockQueue.hasWaitingTask(tokenId)
        ) {
          this._requestPause(record, "scheduled-task", { tokenId });
          results.push({ tokenId, success: false, error: "自动任务占用账号" });
          continue;
        }
        await this.lockQueue.acquire(tokenId, `${record.state.taskId}:torch`, {
          signal: record.runtime.controller.signal,
        });
        const client = this.createClient(token);
        try {
          await client.connect(15_000);
          let roleInfo = await client.sendWithPromise(
            "role_getroleinfo",
            {},
            10_000,
          );
          verifyTokenRoleIdentity(token, roleInfo);
          await client.sendWithPromise(
            "item_consume",
            { itemId: request.itemId, quantity: request.quantity },
            10_000,
          );
          roleInfo = await client.sendWithPromise(
            "role_getroleinfo",
            {},
            10_000,
          );
          const account = record.state.accounts[tokenId];
          const role = roleInfo?.role || roleInfo?.body?.role || {};
          account.torchType = Number(role.autoClickType) || 0;
          account.torchRemaining = Number(role.autoClickTime) || 0;
          account.torchSettleTime = Number(role.autoClickSettleTime) || 0;
          results.push({ tokenId, success: true });
        } finally {
          client.disconnect();
          this.lockQueue.release(tokenId, `${record.state.taskId}:torch`);
        }
      } catch (error) {
        results.push({
          tokenId,
          success: false,
          error: String(error.message || error),
        });
      }
    }
    record.state.lastTorchResult = {
      itemId: request.itemId,
      quantity: request.quantity,
      completedAt: new Date(this.now()).toISOString(),
      results,
    };
    record.runtime.pendingTorch = null;
    for (const account of Object.values(record.state.accounts)) {
      if (account.status === "waiting-manual-torch") account.status = "queued";
    }
    await this._persist(record, true);
    await this._log(record, {
      level: results.every((entry) => entry.success) ? "success" : "warning",
      taskType: "pushingTorch",
      message: `手动火把完成：成功 ${results.filter((entry) => entry.success).length}，失败 ${results.filter((entry) => !entry.success).length}`,
    });
  }

  _releaseLease(record, tokenId) {
    if (!record.runtime.leases.delete(tokenId)) return;
    this.lockQueue.release(tokenId, record.state.taskId);
  }

  _releaseAllLeases(record) {
    for (const tokenId of [...record.runtime.leases.keys()]) {
      this._releaseLease(record, tokenId);
    }
  }

  _schedulePersist(record, force = false) {
    record.state.updatedAt = new Date(this.now()).toISOString();
    if (force) {
      if (record.runtime.saveTimer) clearTimeout(record.runtime.saveTimer);
      record.runtime.saveTimer = null;
      void this._persist(record, true);
      return;
    }
    if (record.runtime.saveTimer) return;
    record.runtime.saveTimer = setTimeout(() => {
      record.runtime.saveTimer = null;
      void this._persist(record);
    }, PERSIST_INTERVAL_MS);
    record.runtime.saveTimer.unref?.();
  }

  async _persist(record, force = false) {
    if (!force && !record.state.runId) return;
    const state = publicRuntimeState(record);
    record.runtime.persistChain = record.runtime.persistChain
      .catch(() => {})
      .then(() =>
        this.dataStore.savePushingRunState?.({
          ...state,
          updatedAt: new Date(this.now()).toISOString(),
        }),
      );
    return record.runtime.persistChain;
  }

  _requireRecord(runId) {
    const record = this.records.get(String(runId));
    if (!record) {
      const error = new Error("推图会话不存在");
      error.statusCode = 404;
      throw error;
    }
    return record;
  }

  async _log(
    record,
    {
      level = "info",
      taskType = "pushingSession",
      tokenId = null,
      tokenName = null,
      message = "",
    } = {},
  ) {
    if (!this.log) return;
    try {
      await this.log({
        level: normalizeType(level),
        taskType,
        tokenId,
        tokenName,
        message,
        runId: record.state.runId,
      });
    } catch {
      // Logging must not stop the push loop.
    }
  }
}
