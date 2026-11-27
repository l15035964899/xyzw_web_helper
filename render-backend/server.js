import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import cors from "cors";
/**
 * XYZW 游戏自动化后端 - Express + local/Supabase storage
 */
import dotenv from "dotenv";
import express from "express";
import cron from "node-cron";
import { createApiKeyMiddleware } from "./lib/apiKeyAuth.js";
import { createAppAuthMiddleware } from "./lib/appAuth.js";
import { applyBatchSettingsToTask } from "./lib/batchSettings.js";
import { getNextCronRun, previewCronExpression } from "./lib/cronSchedule.js";
import { createDataStore } from "./lib/dataStore.js";
import { GameClient } from "./lib/gameClient.js";
import {
  runArenaFights,
  runDailyTasks,
  runResetBottles,
  runXuanwuBlessing,
} from "./lib/gameTasks.js";
import { createLoginProxyMiddleware } from "./lib/loginProxy.js";
import { getShanghaiLogRetentionCutoff } from "./lib/logRetention.js";
import {
  normalizeClientTaskLog,
  sanitizeLogMessage,
} from "./lib/logSanitizer.js";
import { getMaintenanceDelay } from "./lib/maintenanceWindow.js";
import { ManualLeaseManager } from "./lib/manualLeaseManager.js";
import { createNativeTaskDefinitions } from "./lib/nativeBatchTasks.js";
import {
  getArenaFormationMap,
  NightmareRunner,
} from "./lib/nightmareRunner.js";
import { NightmareSequenceGate } from "./lib/nightmareSequenceGate.js";
import {
  createNightmareSequenceState,
  getNightmareSequenceGroups,
  NightmareSequenceStateStore,
} from "./lib/nightmareSequenceState.js";
import {
  getNightmareTeam,
  getNightmareTeamAccountIds,
  nightmareMemberMatchesRole,
  normalizeNightmareSettings,
  validateNightmareSettings,
  validateNightmareTeam,
} from "./lib/nightmareSettings.js";
import { PushSessionManager } from "./lib/pushSessionManager.js";
import {
  expectedRoleIdFromToken,
  findDuplicateExpectedRoles,
  verifyTokenRoleIdentity,
} from "./lib/roleIdentity.js";
import {
  createFailedTaskRetryScheduler,
  DEFERRED_LEGACY_FOLLOWUP_DELAY_MS,
} from "./lib/taskRetry.js";
import { TokenLockQueue } from "./lib/tokenLockQueue.js";
import {
  createTokenRefreshManager,
  refreshCredentialAndUpdateToken,
} from "./lib/tokenRefresh.js";

dotenv.config();
process.env.TZ = process.env.TZ || "Asia/Shanghai";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ==================== 工具函数 ====================
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label || "操作"}超时`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function shanghaiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isNightmareSequenceStartWindow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return (
    parts.weekday === "Sun" &&
    Number(parts.hour) === 23 &&
    Number(parts.minute) >= 50
  );
}

const app = express();
const REDACTED_SECRET = "[REDACTED]";
app.use(createLoginProxyMiddleware());
if (process.env.CORS_ORIGIN) {
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN.split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    }),
  );
}
app.use(express.json({ limit: "2mb" }));

// ==================== 数据存储 ====================
const dataStore = createDataStore(process.env);

// ==================== 任务定义 ====================
const LEGACY_TASK_DEFINITIONS = {
  signIn: {
    name: "签到",
    commands: [{ cmd: "system_signinreward", params: {} }],
  },
  claimHangup: {
    name: "领取挂机奖励",
    commands: [{ cmd: "system_claimhangupreward", params: {} }],
  },
  claimDaily: {
    name: "领取日常奖励",
    commands: [{ cmd: "task_claimdailyreward", params: { rewardId: 0 } }],
  },
  claimDailyPoint: {
    name: "领取每日积分",
    commands: [{ cmd: "task_claimdailypoint", params: { taskId: 1 } }],
  },
  climbTower: {
    name: "爬塔领奖励",
    commands: [
      { cmd: "tower_getinfo", params: {} },
      { cmd: "tower_claimreward", params: {} },
    ],
  },
  climbWeirdTower: {
    name: "怪异塔",
    commands: [
      { cmd: "evotower_getinfo", params: {} },
      { cmd: "evotower_claimreward", params: {} },
    ],
  },
  arenaFight: {
    name: "竞技场",
    run: runArenaFights,
  },
  claimMail: {
    name: "领取邮件附件",
    commands: [{ cmd: "mail_claimallattachment", params: { category: 0 } }],
  },
  legacyHangup: {
    name: "功法挂机",
    commands: [
      { cmd: "legacy_getinfo", params: {} },
      { cmd: "legacy_claimhangup", params: {} },
    ],
  },
  batchLegacyClaim: {
    name: "领取功法残卷",
    commands: [{ cmd: "legacy_claimhangup", params: {} }],
  },
  heroRecruit: {
    name: "武将招募",
    commands: [
      {
        cmd: "hero_recruit",
        params: { byClub: false, recruitNumber: 1, recruitType: 3 },
      },
    ],
  },
  studyGame: {
    name: "学习问答",
    commands: [{ cmd: "study_startgame", params: {} }],
  },
  genieSweep: {
    name: "灯神",
    commands: [{ cmd: "genie_sweep", params: { genieId: 1 } }],
  },
  openBox: {
    name: "开箱",
    commands: [{ cmd: "item_openbox", params: { itemId: 2001, number: 10 } }],
  },
  legionSignIn: {
    name: "军团签到",
    commands: [
      { cmd: "legion_getinfo", params: {} },
      { cmd: "legion_signin", params: {} },
    ],
  },
  bossTower: {
    name: "咸王宝库",
    commands: [
      { cmd: "bosstower_getinfo", params: {} },
      { cmd: "bosstower_startboss", params: {} },
      { cmd: "bosstower_startbox", params: {} },
    ],
  },
  mergeBox: {
    name: "合并魔盒",
    commands: [
      { cmd: "mergebox_getinfo", params: {} },
      { cmd: "mergebox_claimfreeenergy", params: {} },
      { cmd: "mergebox_openbox", params: {} },
    ],
  },
  resetBottles: {
    name: "重置罐子",
    run: runResetBottles,
  },
  batchlingguanzi: {
    name: "领取盐罐",
    commands: [{ cmd: "bottlehelper_claim", params: {} }],
  },
  store_purchase: {
    name: "黑市采购",
    commands: [{ cmd: "store_purchase", params: {} }],
  },
  collection_claimfreereward: {
    name: "珍宝阁免费领取",
    commands: [{ cmd: "collection_claimfreereward", params: {} }],
  },
  batchXuanwuBlessing: {
    name: "玄武赐福",
    run: runXuanwuBlessing,
  },
  dailyBundle: {
    name: "一键日常",
    run: runDailyTasks,
  },
};

for (const definition of Object.values(LEGACY_TASK_DEFINITIONS)) {
  definition.hiddenFromPicker = true;
  definition.group = "legacy";
}

const TASK_DEFINITIONS = {
  ...LEGACY_TASK_DEFINITIONS,
  ...createNativeTaskDefinitions(),
};

function redactTaskSecret(task) {
  if (!task?.options?.securityPassword) return task;
  return {
    ...task,
    options: {
      ...task.options,
      securityPassword: REDACTED_SECRET,
    },
  };
}

// ==================== 日志存储 ====================
const LOG_MAX = 500;
const logs = [];

function addLog(level, category, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    category,
    message,
    ...meta,
  };
  logs.unshift(entry);
  if (logs.length > LOG_MAX) logs.pop();
  console.log(`[${level}] [${category}] ${message}`, meta);
}

// ==================== Token 加载 ====================
async function loadTokens() {
  try {
    const data = await dataStore.listTokens({ enabledOnly: true });
    addLog("INFO", "store", `加载${data.length}个tokens`);
    return data;
  } catch (error) {
    addLog("ERROR", "store", "加载tokens失败", {
      error: error.message,
    });
    return [];
  }
}

function parseTaskKeys(task) {
  let taskKeys = task?.selected_tasks;
  if (typeof taskKeys === "string") {
    try {
      taskKeys = JSON.parse(taskKeys);
    } catch {
      taskKeys = [];
    }
  }
  if ((!Array.isArray(taskKeys) || taskKeys.length === 0) && task?.task_type) {
    taskKeys = [task.task_type];
  }
  return Array.isArray(taskKeys) ? taskKeys : [];
}

function validateNightmareSequenceCron(task, cronExpression) {
  if (
    !parseTaskKeys(task).includes("nightmareChallenge") ||
    String(cronExpression || "") === "50 23 * * 0"
  ) {
    return null;
  }
  return "自动十殿序列固定为每周日 23:50，请使用 Cron: 50 23 * * 0";
}

function gameClientForToken(token) {
  let tokenData;
  try {
    tokenData =
      typeof token.token === "string" && token.token.startsWith("{")
        ? JSON.parse(token.token)
        : {
            roleToken: token.token,
            roleId: token.roleId,
            sessId: token.sessId,
            connId: token.connId,
            isRestore: token.isRestore,
          };
  } catch (error) {
    throw new Error(`Token解析失败: ${token.name} (${error.message})`);
  }
  tokenData.name = token.name;
  return new GameClient(tokenData, token.ws_url);
}

function disconnectNightmareClients(clients) {
  for (const client of clients?.values?.() || []) {
    try {
      client.disconnect();
    } catch {
      // Best effort during cleanup.
    }
  }
}

function isNightmareCleanupUncertain(error) {
  return (
    Boolean(error?.cleanupUncertain) ||
    /未能确认|无法确认|队伍仍在|队伍不存在/.test(
      String(error?.message || error),
    )
  );
}

async function connectNightmareClients(
  tokens,
  { addTaskRunLog, runId, source },
) {
  const clients = new Map();
  const tokensById = new Map(tokens.map((token) => [String(token.id), token]));
  const connectionResults = await Promise.allSettled(
    tokens.map(async (token) => {
      const client = gameClientForToken(token);
      await client.connect(15_000);
      return { token, client };
    }),
  );
  for (const result of connectionResults) {
    if (result.status === "fulfilled") {
      clients.set(String(result.value.token.id), result.value.client);
    }
  }
  const failed = tokens.filter((token) => !clients.has(String(token.id)));
  if (failed.length > 0) {
    disconnectNightmareClients(clients);
    throw new Error(
      `以下账号连接失败：${failed.map((token) => token.name).join("、")}`,
    );
  }

  const seenRoles = new Map();
  try {
    for (const token of tokens) {
      let activeToken = token;
      let client = clients.get(String(token.id));
      let response = await client.sendWithPromise(
        "role_getroleinfo",
        {},
        12_000,
      );
      let identity;
      try {
        identity = verifyTokenRoleIdentity(activeToken, response);
      } catch (error) {
        if (!error.roleIdentityMismatch) throw error;
        await addTaskRunLog?.(
          `${activeToken.name}: 角色身份异常，正在使用 NAS BIN 自动修复`,
          {
            type: "warning",
            taskType: "roleIdentity",
            token: activeToken,
            runId,
            source,
          },
        );
        client.disconnect();
        clients.delete(String(activeToken.id));
        activeToken = await repairTokenIdentityFromCredential(activeToken);
        tokensById.set(String(activeToken.id), activeToken);
        client = gameClientForToken(activeToken);
        await client.connect(15_000);
        clients.set(String(activeToken.id), client);
        response = await client.sendWithPromise("role_getroleinfo", {}, 12_000);
        identity = verifyTokenRoleIdentity(activeToken, response);
      }
      if (!identity.checked) continue;
      const duplicate = seenRoles.get(identity.actualRoleId);
      if (duplicate) {
        throw new Error(
          `${activeToken.name} 实际角色 ${identity.actualRoleId} 与 ${duplicate.name} 重复`,
        );
      }
      seenRoles.set(identity.actualRoleId, activeToken);
      await dataStore
        .updateToken?.(activeToken.id, {
          expected_role_id: identity.expectedRoleId,
          last_verified_role_id: identity.actualRoleId,
          role_identity_verified_at: new Date().toISOString(),
          role_identity_error: null,
        })
        .catch(() => {});
      await addTaskRunLog?.(
        `${activeToken.name}: 角色身份校验通过（${identity.actualRoleId}）`,
        {
          type: "success",
          taskType: "roleIdentity",
          token: activeToken,
          runId,
          source,
        },
      );
    }
    return { clients, tokensById };
  } catch (error) {
    disconnectNightmareClients(clients);
    throw error;
  }
}

function createNightmareSequenceStore(
  savedState,
  { taskId, teams, arenaFormations },
) {
  const resumable =
    savedState?.mode === "sequence" &&
    Array.isArray(savedState.teamSnapshots) &&
    savedState.teamSnapshots.length > 0 &&
    !["completed", "stopped", "stopped-after-cleanup"].includes(
      savedState.phase,
    );
  const initialState = resumable
    ? savedState
    : createNightmareSequenceState({
        taskId,
        teams,
        arenaFormations,
      });
  if (!Object.keys(initialState.arenaFormations || {}).length) {
    initialState.arenaFormations = { ...arenaFormations };
  }
  return new NightmareSequenceStateStore({
    taskId,
    state: initialState,
    saveState: async (state) => {
      await dataStore.saveNightmareRunState?.({
        ...state,
        taskId,
      });
    },
  });
}

async function connectNightmareTeamForSequence(
  team,
  { addTaskRunLog, runId, source },
) {
  const accountIds = new Set(
    getNightmareTeamAccountIds(team).map((tokenId) => String(tokenId)),
  );
  await tokenRefreshManager.run({ tokenIds: [...accountIds] });
  const allTokens = await dataStore.listTokens({ enabledOnly: true });
  const teamTokens = allTokens.filter((token) =>
    accountIds.has(String(token.id)),
  );
  if (teamTokens.length !== accountIds.size) {
    const found = new Set(teamTokens.map((token) => String(token.id)));
    const missing = [...accountIds].filter((id) => !found.has(id));
    throw new Error(`十殿队伍账号不存在或已停用：${missing.join(", ")}`);
  }
  return connectNightmareClients(teamTokens, {
    addTaskRunLog,
    runId,
    source,
  });
}

async function runNightmareSequenceTeam({
  task,
  team,
  stateStore,
  arenaFormations,
  addTaskRunLog,
  runId,
  source,
}) {
  const teamId = String(team.id);
  const tracker = stateStore.snapshot().teams[teamId] || {};
  let clients = new Map();
  await stateStore.updateTeam(teamId, {
    status: "running",
    error: null,
    resumeAt: null,
  });
  await addTaskRunLog(`十殿序列开始队伍“${team.name}”`, {
    type: "info",
    taskType: "nightmareSequenceTeam",
    runId,
    source,
  });

  const connect = async () => {
    const connected = await connectNightmareTeamForSequence(team, {
      addTaskRunLog,
      runId,
      source,
    });
    clients = connected.clients;
    return connected;
  };

  try {
    const connected = await connect();
    const runner = new NightmareRunner({
      clients: connected.clients,
      tokens: connected.tokensById,
      arenaFormations,
      log: (message, type = "info") => {
        void addTaskRunLog(message, {
          type,
          taskType: "nightmare",
          runId,
          source,
        });
      },
    });
    const result = await runner.runChallenge(team, {
      state: tracker.challengeState ||
        stateStore.snapshot().teams[teamId]?.challengeState || {
          taskId: task.id,
          teamId,
        },
      saveState: async (state) => {
        await stateStore.updateTeam(teamId, {
          status: state.phase === "paused-cross-week" ? "paused" : "running",
          challengeState: state,
          resumeAt: state.resumeAt || null,
        });
      },
      onPause: async (state) => {
        disconnectNightmareClients(clients);
        clients = new Map();
        await stateStore.updateTeam(teamId, {
          status: "paused",
          challengeState: state,
          resumeAt: state.resumeAt || null,
        });
        const snapshot = stateStore.snapshot();
        const crossWeekTeams = snapshot.teamSnapshots.filter((entry) =>
          Boolean(entry.crossWeek),
        );
        const unfinished = crossWeekTeams.filter(
          (entry) => snapshot.teams[String(entry.id)]?.status !== "completed",
        );
        if (
          unfinished.length > 0 &&
          unfinished.every(
            (entry) => snapshot.teams[String(entry.id)]?.status === "paused",
          )
        ) {
          await stateStore.update((current) => {
            if (current.phase !== "blocked-cleanup") {
              current.phase = "paused-cross-week";
              current.resumeAt = state.resumeAt || null;
              current.blockedTeamId = null;
            }
          });
        }
        await addTaskRunLog(`队伍“${team.name}”已断开连接，等待跨周继续`, {
          type: "info",
          taskType: "nightmareCrossWeek",
          runId,
          source,
        });
      },
      onResume: async () => {
        await stateStore.updateTeam(teamId, {
          status: "running",
          resumeAt: null,
        });
        await stateStore.update((current) => {
          if (current.phase === "blocked-cleanup") return;
          current.phase = "running";
          current.resumeAt = null;
          current.blockedTeamId = null;
        });
        const resumed = await connect();
        return resumed.clients;
      },
      restoreFormationsOnComplete: false,
    });
    await stateStore.updateTeam(teamId, {
      status: "completed",
      success: Boolean(result.success),
      error: null,
      challengeState: null,
      resumeAt: null,
    });
    await addTaskRunLog(
      `十殿序列队伍“${team.name}”结束：${
        result.success ? "挑战成功" : "配置次数已用完"
      }`,
      {
        type: result.success ? "success" : "warning",
        taskType: "nightmareSequenceTeam",
        runId,
        source,
      },
    );
    return { teamId, ...result };
  } catch (error) {
    const cleanupUncertain = isNightmareCleanupUncertain(error);
    await stateStore.updateTeam(teamId, {
      status: cleanupUncertain ? "blocked" : "aborted",
      success: false,
      error: error.message,
    });
    await stateStore.setPhase(
      cleanupUncertain ? "blocked-cleanup" : "stopped",
      {
        blockedTeamId: cleanupUncertain ? teamId : null,
        blockedReason: cleanupUncertain ? error.message : null,
        resumeAt: null,
      },
    );
    throw error;
  } finally {
    disconnectNightmareClients(clients);
  }
}

async function restoreNightmareSequenceFormations({
  stateStore,
  addTaskRunLog,
  runId,
  source,
}) {
  const state = stateStore.snapshot();
  const accountIds = [
    ...new Set(
      state.teamSnapshots.flatMap((team) =>
        getNightmareTeamAccountIds(team).map(String),
      ),
    ),
  ];
  if (accountIds.length === 0) {
    return { success: true, restored: [], failed: [], targets: {} };
  }
  const accountSet = new Set(accountIds);
  await tokenRefreshManager.run({ tokenIds: accountIds });
  const allTokens = await dataStore.listTokens({ enabledOnly: true });
  const targetTokens = allTokens.filter((token) =>
    accountSet.has(String(token.id)),
  );
  const connected = await connectNightmareClients(targetTokens, {
    addTaskRunLog,
    runId,
    source,
  });
  const runner = new NightmareRunner({
    clients: connected.clients,
    tokens: connected.tokensById,
    arenaFormations:
      state.arenaFormations || getArenaFormationMap(targetTokens),
    log: (message, type = "info") => {
      void addTaskRunLog(message, {
        type,
        taskType: "nightmareRestore",
        runId,
        source,
      });
    },
  });
  try {
    return await runner.restoreFormations();
  } finally {
    disconnectNightmareClients(connected.clients);
  }
}

async function runNightmareSequence({
  task,
  teams,
  arenaFormations,
  addTaskRunLog,
  runId,
  source,
}) {
  const savedState = (await dataStore.getNightmareRunState?.(task.id)) || null;
  const stateStore = createNightmareSequenceStore(savedState, {
    taskId: task.id,
    teams,
    arenaFormations,
  });
  const initialState = stateStore.snapshot();
  await stateStore.setPhase("running", {
    blockedTeamId: null,
    blockedReason: null,
  });
  await addTaskRunLog(
    `十殿序列启动，队伍顺序：${initialState.teamSnapshots
      .map((team) => `${team.name}${team.crossWeek ? "（跨周）" : ""}`)
      .join(" → ")}`,
    {
      type: "info",
      taskType: "nightmareSequence",
      runId,
      source,
    },
  );

  const runTeam = (team) =>
    runNightmareSequenceTeam({
      task,
      team,
      stateStore,
      arenaFormations: stateStore.snapshot().arenaFormations,
      addTaskRunLog,
      runId,
      source,
    });

  const crossWeekTeams = getNightmareSequenceGroups(
    stateStore.snapshot(),
  ).crossWeek;
  const crossWeekResults =
    crossWeekTeams.length > 0
      ? await Promise.allSettled(crossWeekTeams.map(runTeam))
      : [];
  const crossWeekFailure = crossWeekResults.find(
    (result) => result.status === "rejected",
  );
  if (crossWeekFailure) {
    throw crossWeekFailure.reason;
  }

  const sequentialTeams = getNightmareSequenceGroups(
    stateStore.snapshot(),
  ).sequential;
  for (const team of sequentialTeams) {
    await runTeam(team);
  }

  const beforeRestore = stateStore.snapshot();
  const incomplete = Object.values(beforeRestore.teams).filter(
    (team) => team.status !== "completed",
  );
  if (incomplete.length > 0) {
    throw new Error(
      `十殿序列仍有未完成队伍：${incomplete
        .map((team) => team.name || team.id)
        .join("、")}`,
    );
  }
  await addTaskRunLog("十殿序列全部队伍结束，开始统一恢复竞技场阵容", {
    type: "info",
    taskType: "nightmareRestore",
    runId,
    source,
  });
  const restore = await restoreNightmareSequenceFormations({
    stateStore,
    addTaskRunLog,
    runId,
    source,
  });
  const failedTeams = beforeRestore.teamSnapshots
    .filter((team) => !beforeRestore.teams[String(team.id)]?.success)
    .map((team) => team.name);
  const success = failedTeams.length === 0 && restore.success;
  await stateStore.setPhase("completed", {
    success,
    failedTeams,
    restore,
    completedAt: new Date().toISOString(),
    blockedTeamId: null,
    blockedReason: null,
  });
  await addTaskRunLog(
    `十殿序列完成：${beforeRestore.teamSnapshots.length} 支队伍，${
      failedTeams.length ? `挑战未成功：${failedTeams.join("、")}；` : ""
    }阵容恢复 ${restore.restored.length}/${Object.keys(restore.targets || {}).length}`,
    {
      type: success ? "success" : "warning",
      taskType: "taskCompleted",
      runId,
      source,
    },
  );
  return {
    success,
    failedTeams,
    restore,
    state: stateStore.snapshot(),
  };
}

async function verifyRefreshedGameToken(token, refreshed) {
  if (!expectedRoleIdFromToken(token)) {
    return { checked: false, expectedRoleId: null, actualRoleId: null };
  }
  let tokenData;
  try {
    tokenData = JSON.parse(refreshed.token);
  } catch {
    throw new Error("刷新后的 Token 格式无效，无法校验角色身份");
  }
  tokenData.name = token.name;
  const client = new GameClient(tokenData, token.ws_url);
  try {
    await client.connect(15000);
    const response = await client.sendWithPromise("role_getroleinfo", {}, 8000);
    return verifyTokenRoleIdentity(token, response);
  } finally {
    client.disconnect();
  }
}

async function repairTokenIdentityFromCredential(token) {
  const credential = await dataStore.getTokenRefreshCredential?.(token.id);
  if (!credential?.bin) {
    const error = new Error("NAS 没有保存该账号可用于自动修复的 BIN");
    error.code = "MISSING_REFRESH_CREDENTIAL";
    throw error;
  }
  const repaired = await refreshCredentialAndUpdateToken({
    token,
    credential,
    dataStore,
    verifyRefreshedToken: verifyRefreshedGameToken,
  });
  return repaired.updated;
}

// ==================== 任务执行引擎 ====================
const runningTasks = new Set();
const runningNightmareTeams = new Set();
const nightmareSequenceGate = new NightmareSequenceGate();
let failedTaskRetryScheduler = null;
const tokenLockQueue = new TokenLockQueue();
const manualLeaseManager = new ManualLeaseManager({
  lockQueue: tokenLockQueue,
});
const tokenRefreshManager = createTokenRefreshManager({
  dataStore,
  addLog,
  verifyRefreshedToken: verifyRefreshedGameToken,
});
const pushSessionManager = new PushSessionManager({
  dataStore,
  lockQueue: tokenLockQueue,
  tokenRefreshManager,
  createClient: gameClientForToken,
  repairToken: repairTokenIdentityFromCredential,
  log: async ({ level, taskType, tokenId, tokenName, message, runId }) => {
    const safeMessage = sanitizeLogMessage(message);
    addLog(
      level === "error" ? "ERROR" : level === "warning" ? "WARN" : "INFO",
      "pushing",
      safeMessage,
      { tokenId, runId },
    );
    await logToDb(
      null,
      tokenName,
      taskType || "pushingSession",
      level,
      safeMessage,
      { runId, tokenId, source: "nas-pushing", level },
    );
  },
});

async function executeTask(task, { source = "nas", retryAttempt = 0 } = {}) {
  if (!task?.id) throw new Error("任务缺少 id");
  const isNightmareTask = parseTaskKeys(task).includes("nightmareChallenge");
  if (!isNightmareTask) {
    const gateWait = await nightmareSequenceGate.wait(task.id, {
      onWait: (ownerTaskId) => {
        const waitMessage = `十殿序列 ${ownerTaskId} 正在运行，任务“${task.name}”进入等待队列`;
        addLog("INFO", "task", waitMessage, { taskId: task.id });
        void logToDb(
          task.id,
          null,
          "nightmareSequenceWait",
          "info",
          waitMessage,
          { source, level: "info" },
        );
      },
    });
    if (!gateWait.shouldRun) return false;
  }
  if (runningTasks.has(task.id)) {
    addLog("WARN", "task", `任务正在执行，跳过重复调用: ${task.name}`, {
      taskId: task.id,
    });
    return false;
  }

  runningTasks.add(task.id);
  const runId = randomUUID();
  let nightmareGateLease = null;
  let result = null;
  try {
    if (isNightmareTask) {
      nightmareGateLease = await nightmareSequenceGate.acquire(task.id);
    }
    result = await executeTaskUnlocked(task, runId, { source });
    return true;
  } finally {
    if (result?.holdNightmareGate) nightmareGateLease?.hold();
    else nightmareGateLease?.release();
    runningTasks.delete(task.id);
    const failedTokenIds = result?.failedTokenIds || [];
    const deferredTokenIds = result?.deferredTokenIds || [];
    const retryTokenIds = [
      ...new Set([...failedTokenIds, ...deferredTokenIds]),
    ];
    if (retryAttempt === 0 && retryTokenIds.length > 0) {
      const retry = failedTaskRetryScheduler?.schedule({
        task,
        tokenIds: retryTokenIds,
        source,
        reason: failedTokenIds.length > 0 ? "retry" : "deferred",
        delayMs:
          failedTokenIds.length > 0
            ? undefined
            : DEFERRED_LEGACY_FOLLOWUP_DELAY_MS,
      });
      if (retry) {
        const retryMessage =
          failedTokenIds.length > 0
            ? `${retry.tokenIds.length} 个失败账号将在`
            : `${retry.tokenIds.length} 个账号已开始收集，将在`;
        void logToDb(
          task.id,
          null,
          "taskRetryScheduled",
          "info",
          `${task.name}: ${retryMessage} ${new Date(retry.scheduledAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} 自动${failedTokenIds.length > 0 ? "重试一次" : "领取"}`,
          { source: "nas-retry", level: "info" },
        ).catch((error) =>
          addLog("ERROR", "taskRetry", `记录重试计划失败: ${error.message}`, {
            taskId: task.id,
          }),
        );
      }
    }
  }
}

async function executeTaskUnlocked(task, runId, { source = "nas" } = {}) {
  task = applyBatchSettingsToTask(task, await dataStore.getBatchSettings());
  const addTaskRunLog = async (
    message,
    {
      type = "info",
      taskType = null,
      token = null,
      runId = null,
      source = "nas",
    } = {},
  ) => {
    const safeMessage = sanitizeLogMessage(message);
    addLog(
      type === "error" ? "ERROR" : type === "warning" ? "WARN" : "INFO",
      "task",
      safeMessage,
      { taskId: task.id, tokenId: token?.id || null, source },
    );
    await logToDb(
      task.id,
      token?.name || null,
      taskType,
      type === "warning" ? "warn" : type,
      safeMessage,
      { runId, tokenId: token?.id || null, source, level: type },
    );
  };

  await addTaskRunLog(`=== 开始执行定时任务: ${task.name} ===`, {
    taskType: "taskStarted",
    runId,
    source,
  });

  // 兼容旧字段 token_ids 和新字段 selected_tokens
  let tokenIds = task.selected_tokens || task.token_ids;
  if (typeof tokenIds === "string") {
    try {
      tokenIds = JSON.parse(tokenIds);
    } catch {
      tokenIds = [];
    }
  }
  const parsedTaskKeys = parseTaskKeys(task);
  const isNightmareChallenge = parsedTaskKeys.includes("nightmareChallenge");
  if (
    !isNightmareChallenge &&
    (!Array.isArray(tokenIds) || tokenIds.length === 0)
  ) {
    await addTaskRunLog("没有选中的token，跳过", {
      type: "warning",
      runId,
      source,
    });
    return;
  }

  let nightmareExecution = null;
  if (isNightmareChallenge) {
    if (parsedTaskKeys.length !== 1) {
      await addTaskRunLog(
        "自动十殿必须单独放在一个定时任务中，不能与其他任务类型混用",
        { type: "error", runId, source },
      );
      return;
    }
    const settings = normalizeNightmareSettings(task.options?.nightmare);
    const singleTeam =
      source === "nas-manual" && Boolean(task.options?.nightmareSingleTeam);
    let teams;
    if (singleTeam) {
      const selectedTeam = getNightmareTeam(
        settings,
        task.options?.nightmareTeamId,
      );
      if (!selectedTeam) {
        await addTaskRunLog("没有找到可立即执行的十殿队伍配置", {
          type: "error",
          taskType: "nightmare",
          runId,
          source,
        });
        return;
      }
      teams = [
        {
          ...selectedTeam,
          crossWeek: false,
          forceCrossWeek: false,
          fastMode:
            Boolean(task.options?.nightmareForceFastMode) ||
            Boolean(selectedTeam.fastMode),
        },
      ];
    } else {
      teams = settings.teams
        .filter((team) => team.enabled)
        .map((team) => ({
          ...team,
          forceCrossWeek: false,
          fastMode:
            Boolean(task.options?.nightmareForceFastMode) ||
            Boolean(team.fastMode),
        }));
    }
    if (teams.length === 0) {
      await addTaskRunLog("十殿序列没有启用中的队伍", {
        type: "error",
        taskType: "nightmare",
        runId,
        source,
      });
      return;
    }
    for (const team of teams) {
      const teamValidation = validateNightmareTeam(team);
      if (!teamValidation.valid) {
        await addTaskRunLog(
          `十殿队伍“${team.name || team.id}”配置无效：${teamValidation.errors.join("；")}`,
          { type: "error", taskType: "nightmare", runId, source },
        );
        return;
      }
      Object.assign(team, teamValidation.team);
    }
    if (!singleTeam && ["nas-cron", "nas-scheduler"].includes(source)) {
      const existingState =
        (await dataStore.getNightmareRunState?.(task.id)) || null;
      const resumable =
        existingState?.mode === "sequence" &&
        !["completed", "stopped", "stopped-after-cleanup"].includes(
          existingState.phase,
        );
      if (!resumable && !isNightmareSequenceStartWindow()) {
        await addTaskRunLog("自动十殿序列只允许在周日 23:50 启动，本次未执行", {
          type: "error",
          taskType: "nightmare",
          runId,
          source,
        });
        return;
      }
    }
    nightmareExecution = {
      kind: singleTeam ? "single" : "sequence",
      teams,
    };
    tokenIds = [
      ...new Set(
        teams.flatMap((team) => getNightmareTeamAccountIds(team).map(String)),
      ),
    ];
    await addTaskRunLog(
      singleTeam
        ? `手动十殿立即执行队伍“${teams[0].name}”，忽略跨周设置`
        : `自动十殿序列将执行 ${teams.length} 支启用队伍，使用配置账号 ${tokenIds.length} 个，忽略任务中的手选账号`,
      { type: "info", taskType: "nightmare", runId, source },
    );
  }

  // 支持多任务：selected_tasks 是数组，每个元素是 TASK_DEFINITIONS 的 key
  const taskKeys = parsedTaskKeys;
  if (!Array.isArray(taskKeys) || taskKeys.length === 0) {
    await addTaskRunLog("没有选择任何任务类型", {
      type: "error",
      runId,
      source,
    });
    return;
  }

  const taskDefinitions = [];
  for (const key of taskKeys) {
    const taskDef = TASK_DEFINITIONS[key];
    if (!taskDef) {
      await addTaskRunLog(`未知任务类型: ${key}，跳过`, {
        type: "warning",
        taskType: key,
        runId,
        source,
      });
      continue;
    }
    taskDefinitions.push({ key, taskDef });
  }
  if (taskDefinitions.length === 0) {
    await addTaskRunLog("没有有效的命令可执行", {
      type: "error",
      runId,
      source,
    });
    return;
  }

  const allTokens = await loadTokens();
  const targetTokens = allTokens.filter((t) => tokenIds.includes(t.id));
  if (targetTokens.length === 0) {
    await addTaskRunLog("没有找到匹配的tokens", {
      type: "warning",
      runId,
      source,
    });
    return;
  }
  if (nightmareExecution) {
    nightmareExecution.arenaFormations = getArenaFormationMap(targetTokens);
  }

  await addTaskRunLog(`=== 将执行于 ${targetTokens.length} 个角色 ===`, {
    taskType: "taskStarted",
    runId,
    source,
  });

  const duplicateRoleGroups = findDuplicateExpectedRoles(targetTokens);
  const blockedByDuplicate = new Set(
    duplicateRoleGroups.flatMap(({ tokens: duplicates }) =>
      duplicates.map((token) => token.id),
    ),
  );
  if (duplicateRoleGroups.length > 0) {
    await addTaskRunLog(
      duplicateRoleGroups
        .map(
          ({ roleId, tokens: duplicates }) =>
            `检测到重复角色 ${roleId}：${duplicates.map((token) => token.name).join("、")}`,
        )
        .join("；"),
      {
        type: "error",
        taskType: "roleIdentity",
        runId,
        source,
      },
    );
  }

  let taskHadErrors = false;
  const failedTokenIds = [];
  const deferredTokenIds = [];
  const seenActualRoles = new Map();
  let queued = false;
  const taskLease = await tokenLockQueue.acquireAll(
    targetTokens.map((token) => token.id),
    task.id,
    {
      onWait: (holderTaskId) => {
        if (queued) return;
        queued = true;
        void addTaskRunLog(
          `任务“${task.name}”已进入队列，等待前序任务结束 (${holderTaskId})`,
          { taskType: "taskQueue", runId, source },
        );
      },
    },
  );
  if (queued) {
    await addTaskRunLog(`任务“${task.name}”排队结束，开始执行`, {
      taskType: "taskQueue",
      runId,
      source,
    });
  }

  const refreshSummary = await tokenRefreshManager.run({
    tokenIds: targetTokens.map((token) => token.id),
  });
  if (
    refreshSummary.refreshed ||
    refreshSummary.failed ||
    refreshSummary.missingCredentials
  ) {
    await addTaskRunLog(
      `Token 预检查：自动刷新 ${refreshSummary.refreshed}，缺少 BIN 凭据 ${refreshSummary.missingCredentials}，失败 ${refreshSummary.failed}`,
      {
        type: refreshSummary.failed ? "warning" : "info",
        taskType: "tokenRefresh",
        runId,
        source,
      },
    );
  }

  const runTokenAttempt = async (
    token,
    { allowAutomaticRepair = true } = {},
  ) => {
    if (blockedByDuplicate.has(token.id)) {
      await addTaskRunLog(
        `${token.name}: 该账号与其他 Token 绑定到同一预期角色，已阻止执行`,
        {
          type: "error",
          taskType: "roleIdentity",
          token,
          runId,
          source,
        },
      );
      return { hadErrors: true, deferred: false };
    }
    let tokenData;
    try {
      tokenData =
        typeof token.token === "string" && token.token.startsWith("{")
          ? JSON.parse(token.token)
          : {
              roleToken: token.token,
              roleId: token.roleId,
              sessId: token.sessId,
              connId: token.connId,
              isRestore: token.isRestore,
            };
    } catch (err) {
      await addTaskRunLog(`Token解析失败: ${token.name} (${err.message})`, {
        type: "error",
        taskType: "token",
        token,
        runId,
        source,
      });
      return { hadErrors: true };
    }

    tokenData.name = token.name;
    const client = new GameClient(tokenData, token.ws_url);
    let hadErrors = false;
    let deferred = false;
    await addTaskRunLog(`=== 开始执行: ${token.name} ===`, {
      taskType: taskKeys.join(","),
      token,
      runId,
      source,
    });

    try {
      await client.connect(15000);
      const expectedRoleId = expectedRoleIdFromToken(token);
      let roleResponse = null;
      try {
        roleResponse = await client.sendWithPromise(
          "role_getroleinfo",
          {},
          8000,
        );
      } catch (e) {
        if (expectedRoleId) {
          hadErrors = true;
          await addTaskRunLog(
            `${token.name}: 获取角色信息失败，无法确认账号身份，已阻止执行 (${e.message})`,
            {
              type: "error",
              taskType: "roleIdentity",
              token,
              runId,
              source,
            },
          );
          return { hadErrors: true, deferred: false };
        }
        hadErrors = true;
        await addTaskRunLog(`${token.name}: 获取角色信息失败 (${e.message})`, {
          type: "warning",
          taskType: "role_getroleinfo",
          token,
          runId,
          source,
        });
      }

      if (roleResponse) {
        let identity;
        try {
          identity = verifyTokenRoleIdentity(token, roleResponse);
        } catch (error) {
          if (error.roleIdentityMismatch && allowAutomaticRepair) {
            await addTaskRunLog(
              `${token.name}: 检测到角色身份异常，正在使用 NAS BIN 自动修复`,
              {
                type: "warning",
                taskType: "roleIdentity",
                token,
                runId,
                source,
              },
            );
            client.disconnect();
            try {
              const repairedToken =
                await repairTokenIdentityFromCredential(token);
              await addTaskRunLog(
                `${token.name}: 自动修复成功，角色已校正为 ${error.expectedRoleId}，继续执行任务`,
                {
                  type: "success",
                  taskType: "roleIdentity",
                  token: repairedToken,
                  runId,
                  source,
                },
              );
              return await runTokenAttempt(repairedToken, {
                allowAutomaticRepair: false,
              });
            } catch (repairError) {
              hadErrors = true;
              const repairMessage = `自动修复失败：${repairError.message}`;
              await dataStore
                .updateToken?.(token.id, {
                  expected_role_id:
                    expectedRoleIdFromToken(token) ??
                    token.expected_role_id ??
                    null,
                  last_verified_role_id: null,
                  role_identity_verified_at: null,
                  role_identity_error: repairMessage,
                })
                .catch(() => {});
              await addTaskRunLog(
                `${token.name}: ${error.message}；${repairMessage}`,
                {
                  type: "error",
                  taskType: "roleIdentity",
                  token,
                  runId,
                  source,
                },
              );
              return { hadErrors: true, deferred: false };
            }
          }
          hadErrors = true;
          await dataStore
            .updateToken?.(token.id, {
              expected_role_id:
                expectedRoleIdFromToken(token) ??
                token.expected_role_id ??
                null,
              last_verified_role_id: null,
              role_identity_verified_at: null,
              role_identity_error: error.message,
            })
            .catch(() => {});
          await addTaskRunLog(`${token.name}: ${error.message}，已阻止执行`, {
            type: "error",
            taskType: "roleIdentity",
            token,
            runId,
            source,
          });
          return { hadErrors: true, deferred: false };
        }
        if (identity.checked) {
          const previousToken = seenActualRoles.get(identity.actualRoleId);
          if (previousToken) {
            hadErrors = true;
            const duplicateMessage = `实际登录角色 ${identity.actualRoleId} 与 ${previousToken.name} 重复`;
            await dataStore
              .updateToken?.(token.id, {
                expected_role_id: identity.expectedRoleId,
                last_verified_role_id: identity.actualRoleId,
                role_identity_verified_at: new Date().toISOString(),
                role_identity_error: duplicateMessage,
              })
              .catch(() => {});
            await addTaskRunLog(
              `${token.name}: ${duplicateMessage}，已阻止执行`,
              {
                type: "error",
                taskType: "roleIdentity",
                token,
                runId,
                source,
              },
            );
            return { hadErrors: true, deferred: false };
          }
          seenActualRoles.set(identity.actualRoleId, token);
          await dataStore
            .updateToken?.(token.id, {
              expected_role_id: identity.expectedRoleId,
              last_verified_role_id: identity.actualRoleId,
              role_identity_verified_at: new Date().toISOString(),
              role_identity_error: null,
            })
            .catch(() => {});
          await addTaskRunLog(
            `${token.name}: 角色身份校验通过（${identity.actualRoleId}）`,
            {
              type: "success",
              taskType: "roleIdentity",
              token,
              runId,
              source,
            },
          );
        }
      }
      await sleep(500);

      for (const { key, taskDef } of taskDefinitions) {
        try {
          const cmdResults = taskDef.run
            ? await taskDef.run(client, { token, task })
            : await client.executeBatch(taskDef.commands, 800);

          for (const result of cmdResults) {
            const type = !result.success
              ? "error"
              : result.status === "warning"
                ? "warning"
                : result.status === "info"
                  ? "info"
                  : "success";
            if (!result.success) hadErrors = true;
            if (result.deferred) deferred = true;
            const detail =
              result.message ||
              result.error ||
              (result.success ? "执行成功" : "执行失败");
            await addTaskRunLog(`${token.name}: ${detail}`, {
              type,
              taskType: result.cmd,
              token,
              runId,
              source,
            });
          }
        } catch (error) {
          hadErrors = true;
          await addTaskRunLog(`${token.name}: ${error.message}`, {
            type: "error",
            taskType: key,
            token,
            runId,
            source,
          });
          if (!client.connected) break;
        }
      }
    } catch (error) {
      hadErrors = true;
      await addTaskRunLog(`${token.name}: ${error.message}`, {
        type: "error",
        taskType: taskKeys.join(","),
        token,
        runId,
        source,
      });
    } finally {
      client.disconnect();
    }

    await addTaskRunLog(`=== ${token.name} 连接清理结束 ===`, {
      type: "info",
      taskType: taskKeys.join(","),
      token,
      runId,
      source,
    });
    return { hadErrors, deferred };
  };

  if (nightmareExecution) {
    const teamIds = nightmareExecution.teams.map((team) => String(team.id));
    const runningTeamId = teamIds.find((teamId) =>
      runningNightmareTeams.has(teamId),
    );
    if (runningTeamId) {
      await addTaskRunLog(`十殿队伍 ${runningTeamId} 正在运行，跳过重复调用`, {
        type: "warning",
        taskType: "nightmare",
        runId,
        source,
      });
      taskLease.release();
      return { hadErrors: false, failedTokenIds: [], deferredTokenIds: [] };
    }
    teamIds.forEach((teamId) => runningNightmareTeams.add(teamId));
    let clients = new Map();
    try {
      if (nightmareExecution.kind === "sequence") {
        const result = await runNightmareSequence({
          task,
          teams: nightmareExecution.teams,
          arenaFormations: nightmareExecution.arenaFormations,
          addTaskRunLog,
          runId,
          source,
        });
        await dataStore.markTaskRun(task.id);
        return {
          hadErrors: !result.success,
          failedTokenIds: [],
          deferredTokenIds: [],
        };
      }

      const nightmareTeam = nightmareExecution.teams[0];
      const connectCurrentTeam = async () => {
        const connected = await connectNightmareTeamForSequence(nightmareTeam, {
          addTaskRunLog,
          runId,
          source,
        });
        clients = connected.clients;
        return connected;
      };
      const connected = await connectCurrentTeam();
      const savedState =
        (await dataStore.getNightmareRunState?.(task.id)) || null;
      const runner = new NightmareRunner({
        clients,
        tokens: connected.tokensById,
        log: (message, type = "info") => {
          void addTaskRunLog(message, {
            type,
            taskType: "nightmare",
            runId,
            source,
          });
        },
      });
      const initialState =
        savedState && savedState.phase !== "completed"
          ? savedState
          : { taskId: task.id, teamId: nightmareTeam.id };
      const result = await runner.runChallenge(nightmareTeam, {
        state: initialState,
        saveState: async (state) => {
          const saved = await dataStore.saveNightmareRunState?.({
            ...state,
            taskId: task.id,
            teamId: nightmareTeam.id,
          });
          return saved;
        },
        onPause: async (state) => {
          disconnectNightmareClients(clients);
          clients = new Map();
          await addTaskRunLog(
            `手动十殿暂停：${nightmareTeam.name} 的 ${state.resumeAt} 状态已保存`,
            {
              type: "info",
              taskType: "nightmareCrossWeek",
              runId,
              source,
            },
          );
        },
        onResume: async () => {
          const resumed = await connectCurrentTeam();
          clients = resumed.clients;
          return resumed.clients;
        },
      });
      const completedState = {
        taskId: task.id,
        teamId: nightmareTeam.id,
        phase: "completed",
        success: result.success,
        attempts: result.attempts,
        roomId: result.roomId || null,
        updatedAt: new Date().toISOString(),
      };
      await dataStore.saveNightmareRunState?.(completedState);
      await dataStore.markTaskRun(task.id);
      const nightmareLabel = source === "nas-manual" ? "手动十殿" : "自动十殿";
      await addTaskRunLog(
        result.success
          ? `=== ${nightmareLabel}完成：第 ${result.attempts} 次挑战通关 1-8 层 ===`
          : `=== ${nightmareLabel}结束：${nightmareTeam.maxAttempts} 次挑战均失败 ===`,
        {
          type: result.success ? "success" : "error",
          taskType: "taskCompleted",
          runId,
          source,
        },
      );
      return {
        hadErrors: !result.success,
        failedTokenIds: [],
        deferredTokenIds: [],
      };
    } catch (error) {
      const statePromise = dataStore.getNightmareRunState?.(task.id);
      const latestState = statePromise
        ? await statePromise.catch(() => null)
        : null;
      const holdNightmareGate =
        latestState?.phase === "blocked-cleanup" ||
        isNightmareCleanupUncertain(error);
      if (holdNightmareGate && latestState?.phase !== "blocked-cleanup") {
        await dataStore.saveNightmareRunState?.({
          taskId: task.id,
          teamId: nightmareExecution.teams[0]?.id || null,
          mode: nightmareExecution.kind,
          phase: "blocked-cleanup",
          reason: error.message,
          updatedAt: new Date().toISOString(),
        });
      }
      await addTaskRunLog(`十殿执行失败：${error.message}`, {
        type: "error",
        taskType: "nightmare",
        runId,
        source,
      });
      await dataStore.markTaskRun(task.id);
      await addTaskRunLog(`=== 定时任务执行完成: ${task.name} ===`, {
        type: "error",
        taskType: "taskCompleted",
        runId,
        source,
      });
      return {
        hadErrors: true,
        failedTokenIds: [],
        deferredTokenIds: [],
        holdNightmareGate,
      };
    } finally {
      disconnectNightmareClients(clients);
      teamIds.forEach((teamId) => runningNightmareTeams.delete(teamId));
      taskLease.release();
    }
  }

  try {
    const tokenResults =
      taskKeys.length === 1 && taskKeys[0] === "nightmareCharmPurchase"
        ? await Promise.all(targetTokens.map((token) => runTokenAttempt(token)))
        : null;
    if (tokenResults) {
      targetTokens.forEach((token, index) => {
        const result = tokenResults[index];
        if (result.hadErrors) {
          taskHadErrors = true;
          failedTokenIds.push(token.id);
        }
        if (result.deferred) deferredTokenIds.push(token.id);
      });
    } else {
      for (const token of targetTokens) {
        const result = await runTokenAttempt(token);
        if (result.hadErrors) {
          taskHadErrors = true;
          failedTokenIds.push(token.id);
        }
        if (result.deferred) deferredTokenIds.push(token.id);
        await sleep(2000);
      }
    }

    await dataStore.markTaskRun(task.id);
    await addTaskRunLog(`=== 定时任务执行完成: ${task.name} ===`, {
      type: taskHadErrors ? "error" : "success",
      taskType: "taskCompleted",
      runId,
      source,
    });
    return { hadErrors: taskHadErrors, failedTokenIds, deferredTokenIds };
  } finally {
    taskLease.release();
  }
}

failedTaskRetryScheduler = createFailedTaskRetryScheduler({
  dataStore,
  executeTask,
  addLog,
});

async function logToDb(
  taskId,
  tokenName,
  taskType,
  status,
  message,
  { runId = null, tokenId = null, source = "nas", level = null } = {},
) {
  try {
    await dataStore.appendTaskLog({
      run_id: runId,
      task_id: taskId,
      token_id: tokenId,
      token_name: tokenName,
      task_type: taskType,
      status: status || "info",
      level: level || status || "info",
      source,
      message: sanitizeLogMessage(message || ""),
    });
  } catch (e) {
    console.error("写入日志失败:", e.message);
  }
}

async function writeManualNightmareLog({
  taskId,
  runId,
  teamId,
  message,
  type = "info",
  token = null,
  taskType = "nightmare",
}) {
  const level =
    type === "error" ? "ERROR" : type === "warning" ? "WARNING" : "INFO";
  addLog(level, "nightmare", message, { teamId });
  await logToDb(taskId, token?.name || null, taskType, type, message, {
    runId,
    tokenId: token?.id || null,
    source: "nas-manual",
    level: type,
  });
}

// ==================== 定时任务调度 ====================
const cronJobs = new Map();
const maintenanceWaitingTasks = new Set();

async function registerAllCrons() {
  for (const job of cronJobs.values()) job.stop();
  cronJobs.clear();

  let tasks = [];
  try {
    tasks = await dataStore.listTasks({ enabledOnly: true });
    tasks = [...tasks].sort(
      (left, right) =>
        (Number(right.priority) || 0) - (Number(left.priority) || 0),
    );
  } catch (error) {
    addLog("ERROR", "cron", "读取定时任务失败", { error: error.message });
    return;
  }

  for (const task of tasks) {
    registerCron(task);
  }
  addLog("INFO", "cron", `已注册 ${tasks.length} 个定时任务`);
}

async function schedulePausedNightmareResumes() {
  const runs = await dataStore.listNightmareRunStates?.();
  if (!runs) return;
  for (const state of Object.values(runs)) {
    if (!state?.taskId) continue;
    const isSequence = state.mode === "sequence";
    const blocked =
      state.phase === "blocked-cleanup" || state.phase === "blocked";
    const resumable =
      state.phase === "paused-cross-week" ||
      (isSequence && state.phase === "running");
    if (!blocked && !resumable) continue;
    const task = await dataStore.getTask(state.taskId).catch(() => null);
    if (!task) continue;
    try {
      nightmareSequenceGate.restore(task.id);
    } catch (error) {
      addLog("ERROR", "cron", `恢复十殿调度闸门失败: ${error.message}`, {
        taskId: task.id,
      });
      continue;
    }
    if (blocked) {
      addLog(
        "WARN",
        "cron",
        `十殿任务“${task.name}”处于收尾异常状态，定时任务继续保持等待`,
        { taskId: task.id },
      );
      continue;
    }
    const resumeAt = new Date(state.resumeAt || 0).getTime();
    const delayMs = Math.max(0, resumeAt - Date.now());
    setTimeout(() => {
      executeTask(task, { source: "nas-cross-week-resume" }).catch((error) =>
        addLog("ERROR", "cron", `跨周十殿恢复失败: ${error.message}`, {
          taskId: task.id,
        }),
      );
    }, delayMs);
    addLog(
      "INFO",
      "cron",
      `已登记跨周十殿恢复：${task.name}，${new Date(resumeAt).toLocaleString(
        "zh-CN",
        { timeZone: "Asia/Shanghai", hour12: false },
      )}`,
      { taskId: task.id },
    );
  }
}

async function releaseBlockedNightmareGateAfterCleanup(teamId) {
  const runs = await dataStore.listNightmareRunStates?.();
  if (!runs) return [];
  const released = [];
  for (const state of Object.values(runs)) {
    if (state?.phase !== "blocked-cleanup" || !state.taskId) continue;
    const teamIds = new Set(
      (state.teamSnapshots || [])
        .filter((team) => state.teams?.[String(team.id)]?.status === "blocked")
        .map((team) => String(team.id)),
    );
    teamIds.add(String(state.blockedTeamId || state.teamId || ""));
    if (!teamIds.has(String(teamId))) continue;
    const task = await dataStore.getTask(state.taskId).catch(() => null);
    const teams = Object.fromEntries(
      Object.entries(state.teams || {}).map(([id, teamState]) => [
        id,
        String(id) === String(teamId) && teamState.status === "blocked"
          ? { ...teamState, status: "cleanup-confirmed" }
          : teamState,
      ]),
    );
    const remainingBlocked = Object.values(teams).filter(
      (teamState) => teamState.status === "blocked",
    );
    await dataStore.saveNightmareRunState?.({
      ...state,
      phase:
        remainingBlocked.length > 0
          ? "blocked-cleanup"
          : "stopped-after-cleanup",
      teams,
      success: false,
      stoppedAt:
        remainingBlocked.length > 0
          ? state.stoppedAt
          : new Date().toISOString(),
      blockedTeamId: remainingBlocked[0]?.id || null,
      blockedReason: remainingBlocked.length > 0 ? state.blockedReason : null,
    });
    if (remainingBlocked.length > 0) {
      addLog(
        "WARN",
        "nightmare",
        `队伍 ${teamId} 已手动清理，但仍有 ${remainingBlocked.length} 支异常队伍未确认解散`,
        { taskId: state.taskId, teamId },
      );
      continue;
    }
    nightmareSequenceGate.releaseOwner(state.taskId);
    released.push(state.taskId);
    addLog(
      "INFO",
      "nightmare",
      `手动清理队伍 ${teamId} 成功，已解除十殿调度闸门`,
      { taskId: state.taskId, teamId },
    );
    await logToDb(
      state.taskId,
      null,
      "nightmareGateReleased",
      "info",
      task
        ? `任务“${task.name}”的异常十殿收尾已清理，定时任务恢复执行`
        : `十殿任务 ${state.taskId} 的异常收尾已清理，定时任务恢复执行`,
      { source: "nas-manual", level: "info" },
    );
  }
  return released;
}

function registerCron(task) {
  if (cronJobs.has(task.id)) {
    cronJobs.get(task.id).stop();
  }
  // 兼容旧字段 cron_expression 和新字段 cron_expr
  const cronExpr = task.cron_expr || task.cron_expression;
  if (!task.enabled || !cronExpr) return;

  try {
    const job = cron.schedule(
      cronExpr,
      async () => {
        try {
          let runnableTask = task;
          const maintenance = getMaintenanceDelay(new Date());
          if (maintenance.delayMs > 0 && maintenance.resumeAt) {
            if (maintenanceWaitingTasks.has(task.id)) {
              addLog(
                "WARN",
                "cron",
                `任务“${task.name}”已在维护避让队列中，忽略重复触发`,
                { taskId: task.id },
              );
              return;
            }
            maintenanceWaitingTasks.add(task.id);
            const resumeText = maintenance.resumeAt.toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
              hour12: false,
            });
            const waitMessage = `周五维护避让：任务“${task.name}”将在 ${resumeText} 后补跑`;
            addLog("WARN", "cron", waitMessage, { taskId: task.id });
            await logToDb(
              task.id,
              null,
              "maintenanceDeferred",
              "info",
              waitMessage,
            );
            try {
              await sleep(maintenance.delayMs);
            } finally {
              maintenanceWaitingTasks.delete(task.id);
            }
            runnableTask = await dataStore.getTask(task.id);
            if (!runnableTask?.enabled) {
              addLog(
                "INFO",
                "cron",
                `维护结束后任务“${task.name}”已停用或删除，取消补跑`,
                { taskId: task.id },
              );
              return;
            }
            addLog(
              "INFO",
              "cron",
              `维护窗口已结束，开始补跑任务“${task.name}”`,
              { taskId: task.id },
            );
          }
          const gateWait = await nightmareSequenceGate.wait(task.id, {
            onWait: (ownerTaskId) => {
              const waitMessage = `十殿序列 ${ownerTaskId} 正在运行，任务“${task.name}”进入等待队列`;
              addLog("INFO", "cron", waitMessage, { taskId: task.id });
              void logToDb(
                task.id,
                null,
                "nightmareSequenceWait",
                "info",
                waitMessage,
                { source: "nas-cron", level: "info" },
              );
            },
          });
          if (!gateWait.shouldRun) {
            addLog(
              "INFO",
              "cron",
              `任务“${task.name}”已在十殿等待队列中，忽略重复触发`,
              { taskId: task.id },
            );
            return;
          }
          if (gateWait.waited) {
            runnableTask = await dataStore.getTask(task.id);
            if (!runnableTask?.enabled) {
              addLog(
                "INFO",
                "cron",
                `十殿序列结束，但任务“${task.name}”已停用，取消补跑`,
                { taskId: task.id },
              );
              return;
            }
            addLog("INFO", "cron", `十殿序列结束，开始补跑任务“${task.name}”`, {
              taskId: task.id,
            });
          }
          await executeTask(runnableTask, { source: "nas-cron" });
        } catch (err) {
          addLog("ERROR", "cron", `任务执行异常: ${task.name}`, {
            error: err.message,
          });
        }
      },
      { timezone: "Asia/Shanghai" },
    );
    cronJobs.set(task.id, job);
    addLog(
      "INFO",
      "cron",
      `注册定时任务: ${task.name} (${cronExpr} Asia/Shanghai)`,
    );
  } catch (err) {
    addLog("ERROR", "cron", `注册失败: ${task.name}`, { error: err.message });
  }
}

async function init() {
  addLog("INFO", "server", "服务器启动中...");
  addLog(
    "INFO",
    "server",
    dataStore.kind === "local"
      ? `本地数据目录: ${dataStore.root}`
      : `Supabase: ${process.env.SUPABASE_URL}`,
  );

  await dataStore.init();
  await pushSessionManager.restore();
  await schedulePausedNightmareResumes();
  await registerAllCrons();

  // 每天上海时间 00:00 删除前天及更早的日志，保留今天和昨天。
  cron.schedule(
    "0 0 * * *",
    async () => {
      addLog("INFO", "cron", "执行每日日志清理...");
      try {
        const deleted = await dataStore.deleteTaskLogsBefore(
          getShanghaiLogRetentionCutoff().toISOString(),
        );
        addLog("INFO", "cron", `已清理 ${deleted} 条旧任务日志`);
      } catch (err) {
        addLog("ERROR", "cron", "日志清理异常", { error: err.message });
      }
    },
    { timezone: "Asia/Shanghai" },
  );

  setInterval(
    async () => {
      addLog("INFO", "cron", "重新加载定时任务配置...");
      await registerAllCrons();
    },
    5 * 60 * 1000,
  );

  addLog("INFO", "server", "服务器就绪");
}

// ==================== API 路由 ====================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString(),
    activeCrons: cronJobs.size,
    logsInMemory: logs.length,
    storage: dataStore.kind,
  });
});

app.use(createAppAuthMiddleware());
// API routes accept either the shared API key or the authenticated web session.
const apiKeyOnly = createApiKeyMiddleware(() => process.env.API_KEY);
app.use(
  "/api",
  createApiKeyMiddleware(
    () => process.env.API_KEY,
    (req) => req.appUserAuthenticated,
  ),
);

app.post("/api/cron/preview", (req, res) => {
  const preview = previewCronExpression(req.body?.cron_expr || req.body?.cron, {
    count: req.body?.count,
  });
  res.status(preview.valid ? 200 : 400).json(preview);
});

app.get("/api/batch-settings", async (req, res) => {
  try {
    const settings = await dataStore.getBatchSettings();
    res.json({
      ...settings,
      _initialized: await dataStore.hasBatchSettings(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/batch-settings", async (req, res) => {
  try {
    res.json(await dataStore.updateBatchSettings(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

async function loadNightmareTeamById(teamId) {
  const settings = await dataStore.getBatchSettings();
  const team = (settings.nightmare?.teams || []).find(
    (entry) => String(entry.id) === String(teamId),
  );
  if (!team) throw new Error("十殿队伍配置不存在");
  return { settings, team };
}

const nightmareTeamStatusCache = new Map();
const nightmareTeamStatusRequests = new Map();

async function inspectNightmareTeamStatus(team, { force = false } = {}) {
  const cacheKey = String(team.id);
  const cached = nightmareTeamStatusCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.cachedAt < 4_000) {
    return cached.value;
  }
  if (runningNightmareTeams.has(cacheKey)) {
    return {
      teamId: team.id,
      status: "running",
      exists: true,
      checkedAt: new Date().toISOString(),
      message: "自动十殿任务正在运行",
    };
  }
  const leaderTokenId = String(team.leaderTokenId);
  if (!leaderTokenId) throw new Error("队伍尚未配置队长");
  if (tokenLockQueue.isLocked(leaderTokenId)) {
    return {
      teamId: team.id,
      status: "busy",
      exists: true,
      checkedAt: new Date().toISOString(),
      message: "队长账号正被其他任务占用，暂不连接查询",
    };
  }
  const lockTaskId = `nightmare-status:${team.id}`;
  await tokenLockQueue.acquire(leaderTokenId, lockTaskId);
  let client = null;
  try {
    const leader = (await dataStore.listTokens()).find(
      (entry) => String(entry.id) === leaderTokenId,
    );
    if (!leader || !leader.enabled) throw new Error("队长账号不存在或已停用");
    client = gameClientForToken(leader);
    await withTimeout(client.connect(12_000), 15_000, "连接队长账号");
    const roleResponse = await withTimeout(
      client.sendWithPromise("role_getroleinfo", {}, 10_000),
      12_000,
      "读取队长角色",
    );
    const roleId = Number(
      roleResponse?.role?.roleId ||
        roleResponse?.roleId ||
        expectedRoleIdFromToken(leader),
    );
    const mine = await withTimeout(
      client.sendWithPromise(
        "matchteam_getroleteaminfo",
        { roleID: roleId },
        8_000,
      ),
      10_000,
      "读取队长所在队伍",
    );
    const teams = Object.values(mine?.roleMTData?.gDMTData || {})
      .map((entry) => ({
        teamId: String(entry?.teamId || ""),
        teamCfgId: Number(entry?.teamCfgId || 0),
      }))
      .filter((entry) => entry.teamId);
    const current = teams.find((entry) => entry.teamCfgId === 1) || null;
    if (!current) {
      const value = {
        teamId: team.id,
        status: "none",
        exists: false,
        matchTeamId: null,
        roomId: null,
        checkedAt: new Date().toISOString(),
        members: [],
        preparedCount: 0,
        memberCount: 0,
      };
      nightmareTeamStatusCache.set(cacheKey, {
        cachedAt: Date.now(),
        value,
      });
      return value;
    }
    const teamResponse = await withTimeout(
      client.sendWithPromise(
        "matchteam_getteaminfo",
        { teamId: current.teamId },
        8_000,
      ),
      10_000,
      "读取队伍成员状态",
    );
    const teamInfo = teamResponse?.teamInfo || {};
    const members = (teamInfo.fightRoleBase || []).map((entry) => ({
      roleId: Number(entry.roleId || 0),
      name: entry.name || "",
      prepared: Number(entry.prepared || 0) === 1,
      power: Number(entry.power || 0),
    }));
    const configuredMain = (await dataStore.listTokens()).find(
      (entry) => String(entry.id) === String(team.mainTokenId),
    );
    const expectedMainRoleId = expectedRoleIdFromToken(configuredMain) || 0;
    if (
      expectedMainRoleId &&
      !(teamInfo.fightRoleBase || []).some((entry) =>
        nightmareMemberMatchesRole(entry, expectedMainRoleId),
      )
    ) {
      await withTimeout(
        client.sendWithPromise(
          "matchteam_dismiss",
          { teamId: current.teamId },
          8_000,
        ),
        10_000,
        "解散主力已退出的队伍",
      );
      const value = {
        teamId: team.id,
        status: "none",
        exists: false,
        matchTeamId: null,
        roomId: null,
        checkedAt: new Date().toISOString(),
        members: [],
        preparedCount: 0,
        memberCount: 0,
        autoDisbanded: true,
        message: "主力已退出队伍，系统已自动解散",
      };
      nightmareTeamStatusCache.set(cacheKey, {
        cachedAt: Date.now(),
        value,
      });
      return value;
    }
    const preparedCount = members.filter((entry) => entry.prepared).length;
    const expectedNonLeaders = Math.max(0, members.length - 1);
    let roomId = null;
    let currentLayer = 0;
    try {
      const nightmare = await withTimeout(
        client.sendWithPromise("nightmare_getroleinfo", { roleId }, 8_000),
        6_000,
        "读取十殿房间状态",
      );
      const info = nightmare?.nightMareData || nightmare || {};
      roomId = info.roomId ? String(info.roomId) : null;
      currentLayer = Number(info.curMonsterCfgId || 0);
    } catch {
      // Team status remains useful even when nightmare role info is unavailable.
    }
    const allPrepared =
      members.length >= 2 && preparedCount >= expectedNonLeaders;
    const value = {
      teamId: team.id,
      status: roomId ? "challenge" : allPrepared ? "ready" : "team",
      exists: true,
      matchTeamId: current.teamId,
      roomId,
      currentLayer,
      checkedAt: new Date().toISOString(),
      members,
      memberCount: members.length,
      preparedCount: Math.max(0, preparedCount),
      allPrepared,
    };
    nightmareTeamStatusCache.set(cacheKey, {
      cachedAt: Date.now(),
      value,
    });
    return value;
  } finally {
    client?.disconnect();
    tokenLockQueue.release(leaderTokenId, lockTaskId);
  }
}

async function prepareNightmareTeamManually(team) {
  const accountIds = getNightmareTeamAccountIds(team);
  if (accountIds.length < 2 || accountIds.length > 5) {
    throw new Error("十殿队伍人数必须为 2～5 人");
  }
  const key = String(team.id);
  const taskId = `nightmare-manual-${key}`;
  const runId = randomUUID();
  const writeLog = (message, type = "info", token = null) =>
    writeManualNightmareLog({
      taskId,
      runId,
      teamId: team.id,
      message,
      type,
      token,
    });
  if (runningNightmareTeams.has(key)) {
    await writeLog("手动创建队伍失败：该十殿队伍正在运行", "error");
    throw new Error("该十殿队伍正在运行");
  }
  runningNightmareTeams.add(key);
  let clients = new Map();
  let lease = null;
  try {
    await writeLog(
      `=== 开始手动创建/准备十殿队伍：${team.name || team.id} ===`,
      "info",
    );
    lease = await tokenLockQueue.acquireAll(
      accountIds,
      `manual-prepare:${key}`,
    );
    await tokenRefreshManager.run({ tokenIds: accountIds });
    const allowed = new Set(accountIds.map(String));
    const tokens = (await dataStore.listTokens({ enabledOnly: true })).filter(
      (token) => allowed.has(String(token.id)),
    );
    if (tokens.length !== accountIds.length) {
      throw new Error("十殿队伍中有账号不存在或已停用");
    }
    const connected = await connectNightmareClients(tokens, {
      runId,
      source: "nas-manual",
      addTaskRunLog: async (message, options = {}) => {
        await writeLog(message, options.type || "info", options.token);
      },
    });
    clients = connected.clients;
    const runner = new NightmareRunner({
      clients,
      tokens: connected.tokensById,
      log: (message, type = "info") => {
        void writeLog(message, type);
      },
    });
    const result = await runner.prepare(team);
    await writeLog(
      `=== 手动创建/准备十殿队伍完成：游戏队伍 ${result.teamId}，可用成员 ${result.activeTokenIds.length} 人 ===`,
      "success",
    );
    return result;
  } catch (error) {
    await writeLog(`手动创建/准备十殿队伍失败：${error.message}`, "error");
    throw error;
  } finally {
    disconnectNightmareClients(clients);
    lease?.release();
    runningNightmareTeams.delete(key);
  }
}

async function disbandNightmareTeamManually(team) {
  const accountIds = getNightmareTeamAccountIds(team);
  const key = String(team.id);
  const taskId = `nightmare-manual-${key}`;
  const runId = randomUUID();
  const writeLog = (message, type = "info", token = null) =>
    writeManualNightmareLog({
      taskId,
      runId,
      teamId: team.id,
      message,
      type,
      token,
    });
  if (runningNightmareTeams.has(key)) {
    await writeLog("手动解散队伍失败：该十殿队伍正在运行", "error");
    throw new Error("该十殿队伍正在运行，不能手动解散");
  }
  runningNightmareTeams.add(key);
  let clients = new Map();
  let lease = null;
  try {
    await writeLog(
      `=== 开始手动解散十殿队伍：${team.name || team.id} ===`,
      "info",
    );
    lease = await tokenLockQueue.acquireAll(
      accountIds,
      `manual-disband:${key}`,
    );
    await tokenRefreshManager.run({ tokenIds: accountIds });
    const allowed = new Set(accountIds.map(String));
    const tokens = (await dataStore.listTokens({ enabledOnly: true })).filter(
      (token) => allowed.has(String(token.id)),
    );
    if (tokens.length !== accountIds.length) {
      throw new Error("十殿队伍中有账号不存在或已停用");
    }
    const connected = await connectNightmareClients(tokens, {
      runId,
      source: "nas-manual",
      addTaskRunLog: async (message, options = {}) => {
        await writeLog(message, options.type || "info", options.token);
      },
    });
    clients = connected.clients;
    const arenaFormations = getArenaFormationMap(tokens);
    const runner = new NightmareRunner({
      clients,
      tokens: connected.tokensById,
      arenaFormations,
      log: (message, type = "info") => {
        void writeLog(message, type);
      },
    });
    runner.leaderTokenId = String(team.leaderTokenId);
    await runner.initializeRoleIds();
    const current = await runner.currentNightmareTeam(team.leaderTokenId);
    const matchTeamId = String(current?.teamId || "");
    await runner.findExistingRoom(team);
    await runner.dismissChallenge(team);
    const arenaRestore = await runner.restoreFormations();
    nightmareTeamStatusCache.delete(key);
    await writeLog(
      `=== 手动解散完成：游戏队伍 ${matchTeamId || "无"}，竞技场阵容恢复成功 ${arenaRestore.restored.length}/${tokens.length} 人${
        arenaRestore.failed.length > 0
          ? `，失败：${arenaRestore.failed
              .map(
                (entry) =>
                  `${
                    tokens.find(
                      (token) => String(token.id) === String(entry.tokenId),
                    )?.name || entry.tokenId
                  }→阵容${entry.target}`,
              )
              .join("、")}`
          : ""
      } ===`,
      arenaRestore.success ? "success" : "warning",
    );
    return {
      ok: true,
      alreadyDisbanded: !matchTeamId,
      teamId: team.id,
      matchTeamId: matchTeamId || null,
      arenaFormations,
      arenaRestore,
    };
  } catch (error) {
    await writeLog(`手动解散十殿队伍失败：${error.message}`, "error");
    throw error;
  } finally {
    disconnectNightmareClients(clients);
    lease?.release();
    runningNightmareTeams.delete(key);
  }
}

app.get("/api/nightmare/status", async (req, res) => {
  try {
    res.json({
      runningTeamIds: [...runningNightmareTeams],
      scheduledGate: nightmareSequenceGate.snapshot(),
      runs: (await dataStore.listNightmareRunStates?.()) || {},
      accountLocks: tokenLockQueue.snapshot(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/nightmare/teams/:id/status", async (req, res) => {
  try {
    const { team } = await loadNightmareTeamById(req.params.id);
    const teamId = String(team.id);
    let request = nightmareTeamStatusRequests.get(teamId);
    if (!request) {
      request = inspectNightmareTeamStatus(team, {
        force: req.query.refresh === "1",
      }).finally(() => {
        nightmareTeamStatusRequests.delete(teamId);
      });
      nightmareTeamStatusRequests.set(teamId, request);
    }
    const status = await request;
    res.json(status);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch("/api/nightmare/settings", async (req, res) => {
  try {
    const validation = validateNightmareSettings(req.body?.nightmare);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.errors.join("；") });
    }
    const settings = await dataStore.updateBatchSettings({
      nightmare: validation.settings,
    });
    res.json({ ok: true, nightmare: settings.nightmare });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/nightmare/teams/:id/prepare", async (req, res) => {
  try {
    const { team } = await loadNightmareTeamById(req.params.id);
    const result = await prepareNightmareTeamManually(team);
    nightmareTeamStatusCache.delete(String(team.id));
    res.json({ ok: true, teamId: team.id, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/nightmare/teams/:id/disband", async (req, res) => {
  try {
    const { team } = await loadNightmareTeamById(req.params.id);
    const result = await disbandNightmareTeamManually(team);
    nightmareTeamStatusCache.delete(String(team.id));
    await releaseBlockedNightmareGateAfterCleanup(team.id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/nightmare/teams/:id/start", async (req, res) => {
  try {
    const { settings, team } = await loadNightmareTeamById(req.params.id);
    if (nightmareSequenceGate.isActive()) {
      return res.status(409).json({
        error: "十殿序列或其他十殿任务正在运行，请等待结束后再立即执行",
      });
    }
    const validation = validateNightmareSettings(settings.nightmare);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.errors.join("；") });
    }
    const taskId = `nightmare-manual-${team.id}`;
    if (
      runningTasks.has(taskId) ||
      runningNightmareTeams.has(String(team.id))
    ) {
      return res.status(409).json({ error: "该十殿队伍正在运行" });
    }
    const pseudoTask = {
      id: taskId,
      name: `手动-${team.name}`,
      enabled: true,
      cron_expr: "0 0 1 1 *",
      selected_tasks: ["nightmareChallenge"],
      selected_tokens: getNightmareTeamAccountIds(team),
      options: {
        nightmare: settings.nightmare,
        nightmareTeamId: team.id,
        nightmareSingleTeam: true,
      },
    };
    nightmareTeamStatusCache.delete(String(team.id));
    executeTask(pseudoTask, { source: "nas-manual" }).catch((error) =>
      addLog("ERROR", "nightmare", `手动十殿启动失败: ${error.message}`, {
        teamId: team.id,
      }),
    );
    res.json({ status: "running", teamId: team.id, teamName: team.name });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/nightmare/charm-purchase", async (req, res) => {
  try {
    const tokenIds = [
      ...new Set((req.body?.token_ids || []).map(String).filter(Boolean)),
    ];
    if (tokenIds.length === 0) {
      return res.status(400).json({ error: "请至少选择一个抢符账号" });
    }
    const settings = await dataStore.getBatchSettings();
    const taskId = `nightmare-charm-manual-${Date.now()}`;
    const pseudoTask = {
      id: taskId,
      name: "手动-抢十殿符咒",
      enabled: true,
      cron_expr: "0 0 1 1 *",
      selected_tasks: ["nightmareCharmPurchase"],
      selected_tokens: tokenIds,
      options: { nightmare: settings.nightmare },
    };
    executeTask(pseudoTask, { source: "nas-manual" }).catch((error) =>
      addLog("ERROR", "nightmare", `手动抢符启动失败: ${error.message}`),
    );
    res.json({ status: "running", taskId });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/tasks/runtime", (req, res) => {
  const lockHolders = tokenLockQueue.snapshot();
  res.json({
    runningTaskIds: [...runningTasks],
    manualLeases: manualLeaseManager.list(),
    pushing: pushSessionManager.status(),
    accountLocks: Object.entries(lockHolders).map(([tokenId, holder]) => ({
      token_id: tokenId,
      holder,
    })),
  });
});

app.get("/api/manual-leases", (req, res) => {
  res.json(manualLeaseManager.list());
});

app.post("/api/manual-leases", async (req, res) => {
  try {
    const tokenIds = [...new Set((req.body?.token_ids || []).map(String))];
    const accounts = await dataStore.listTokens({ enabledOnly: true });
    const allowed = new Set(accounts.map((account) => String(account.id)));
    const missing = tokenIds.filter((tokenId) => !allowed.has(tokenId));
    if (missing.length > 0) {
      return res.status(400).json({
        error: `账号不存在或已停用：${missing.join(", ")}`,
      });
    }
    const lease = await manualLeaseManager.acquire(tokenIds, {
      ttlMs: req.body?.ttl_ms || req.body?.ttlMs,
      owner: req.body?.owner,
    });
    res.json(lease);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/pushing/runs", async (req, res) => {
  try {
    const state = await pushSessionManager.start({
      tokenIds: Array.isArray(req.body?.token_ids)
        ? req.body.token_ids
        : req.body?.tokenIds,
      options: req.body?.options,
      requestedBy: req.body?.requested_by || req.body?.requestedBy,
    });
    res.status(202).json(state);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

app.get("/api/pushing/status", (req, res) => {
  res.json(pushSessionManager.status());
});

app.get("/api/pushing/runs/:id", (req, res) => {
  const state = pushSessionManager.get(req.params.id);
  if (!state) return res.status(404).json({ error: "推图会话不存在" });
  res.json(state);
});

app.post("/api/pushing/runs/:id/stop", async (req, res) => {
  try {
    const state = await pushSessionManager.stop(
      req.params.id,
      req.body?.reason,
    );
    res.json(state);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

app.post("/api/pushing/runs/:id/use-torch", async (req, res) => {
  try {
    const result = await pushSessionManager.requestTorch(req.params.id, {
      tokenIds: Array.isArray(req.body?.token_ids)
        ? req.body.token_ids
        : req.body?.tokenIds,
      itemId: req.body?.item_id ?? req.body?.itemId,
      quantity: req.body?.quantity,
    });
    res.status(202).json(result);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

app.post("/api/manual-leases/:id/heartbeat", (req, res) => {
  const lease = manualLeaseManager.heartbeat(req.params.id, {
    ttlMs: req.body?.ttl_ms || req.body?.ttlMs,
  });
  if (!lease) return res.status(404).json({ error: "手动租约不存在或已过期" });
  res.json(lease);
});

app.delete("/api/manual-leases/:id", (req, res) => {
  const released = manualLeaseManager.release(req.params.id);
  if (!released) return res.status(404).json({ error: "手动租约不存在" });
  res.json({ ok: true });
});

app.post("/api/logs/db/batch", async (req, res) => {
  try {
    const logs = Array.isArray(req.body?.logs) ? req.body.logs : [];
    if (logs.length === 0) return res.json({ accepted: 0, logs: [] });
    if (logs.length > 500) {
      return res.status(400).json({ error: "单次最多写入 500 条日志" });
    }
    const normalized = logs.map((entry) => normalizeClientTaskLog(entry));
    const created = await dataStore.appendTaskLogs(normalized);
    res.json({ accepted: created.length, logs: created });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/tokens", async (req, res) => {
  try {
    res.json(await dataStore.listTokens());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/tokens/:id/game-bin", apiKeyOnly, async (req, res) => {
  try {
    const token = (await dataStore.listTokens()).find(
      (entry) => String(entry.id) === String(req.params.id),
    );
    if (!token) return res.status(404).json({ error: "账号不存在" });
    const credential = await dataStore.getTokenRefreshCredential?.(
      req.params.id,
    );
    if (!credential?.bin) {
      return res.status(404).json({ error: "NAS 未保存该账号的 BIN" });
    }
    const body = Buffer.isBuffer(credential.bin)
      ? credential.bin
      : Buffer.from(credential.bin);
    if (body.length === 0 || body.length > 2 * 1024 * 1024) {
      return res.status(422).json({ error: "账号 BIN 数据无效" });
    }
    res.set({
      "Cache-Control": "no-store, private",
      "Content-Disposition": 'attachment; filename="game.bin"',
      "Content-Length": String(body.length),
      "Content-Type": "application/octet-stream",
      Expires: "0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/tokens", async (req, res) => {
  try {
    const created = await dataStore.createToken(req.body);
    res.json([created]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch("/api/tokens/:id", async (req, res) => {
  try {
    const updated = await dataStore.updateToken(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "账号不存在" });
    res.json([updated]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put("/api/tokens/:id/refresh-credential", async (req, res) => {
  try {
    const account = await dataStore.getToken(req.params.id);
    if (!account) return res.status(404).json({ error: "账号不存在" });
    const encoded = String(req.body?.bin_base64 || "");
    if (!encoded) throw new Error("缺少 BIN 登录凭据");
    if (encoded.length > 2_700_000) throw new Error("BIN 登录凭据过大");
    const bin = Buffer.from(encoded, "base64");
    if (bin.length < 32 || bin.length > 2_000_000) {
      throw new Error("BIN 登录凭据格式错误");
    }
    const credential = await dataStore.saveTokenRefreshCredential(
      req.params.id,
      bin,
    );
    const refresh = await tokenRefreshManager.run({
      tokenIds: [req.params.id],
      force: true,
    });
    if (refresh.failed) {
      return res.status(422).json({
        ok: false,
        error: "BIN 已保存，但刷新后的角色身份校验失败",
        ...credential,
        refresh,
      });
    }
    res.json({ ok: true, ...credential, refresh });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/tokens/:id", async (req, res) => {
  try {
    await dataStore.deleteToken(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/token-refresh/status", async (req, res) => {
  try {
    res.json(await tokenRefreshManager.status());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/token-refresh/run", async (req, res) => {
  try {
    const result = await tokenRefreshManager.run({
      tokenIds: Array.isArray(req.body?.token_ids) ? req.body.token_ids : null,
      force: Boolean(req.body?.force),
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/tasks", async (req, res) => {
  try {
    const tasks = await dataStore.listTasks();
    res.json(
      tasks.map((task) => {
        const next = task.enabled
          ? getNextCronRun(task.cron_expr || task.cron_expression)
          : null;
        return {
          ...redactTaskSecret(task),
          next_run_at: next ? next.toISOString() : null,
          running: runningTasks.has(task.id),
        };
      }),
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/tasks", async (req, res) => {
  try {
    const cronExpr =
      req.body.cron_expr || req.body.cron_expression || req.body.cron;
    const preview = previewCronExpression(cronExpr);
    if (!preview.valid) {
      return res.status(400).json({ error: preview.message });
    }
    const nightmareScheduleError = validateNightmareSequenceCron(
      req.body,
      preview.normalized,
    );
    if (nightmareScheduleError) {
      return res.status(400).json({ error: nightmareScheduleError });
    }
    const created = await dataStore.createTask({
      ...req.body,
      cron_expr: preview.normalized,
    });
    registerCron(created);
    res.json([redactTaskSecret(created)]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch("/api/tasks/:id", async (req, res) => {
  try {
    const current = await dataStore.getTask(req.params.id);
    if (!current) return res.status(404).json({ error: "任务不存在" });
    const cronExpr =
      req.body.cron_expr ||
      req.body.cron_expression ||
      req.body.cron ||
      current.cron_expr ||
      current.cron_expression;
    const preview = previewCronExpression(cronExpr);
    if (!preview.valid) {
      return res.status(400).json({ error: preview.message });
    }
    const nightmareScheduleError = validateNightmareSequenceCron(
      {
        ...current,
        ...req.body,
        selected_tasks:
          req.body.selected_tasks !== undefined
            ? req.body.selected_tasks
            : current.selected_tasks,
      },
      preview.normalized,
    );
    if (nightmareScheduleError) {
      return res.status(400).json({ error: nightmareScheduleError });
    }
    const mergedOptions = {
      ...(current.options || {}),
      ...(req.body.options || {}),
    };
    if (
      mergedOptions.securityPassword === REDACTED_SECRET &&
      current.options?.securityPassword
    ) {
      mergedOptions.securityPassword = current.options.securityPassword;
    }
    const updated = await dataStore.updateTask(req.params.id, {
      ...req.body,
      cron_expr: preview.normalized,
      options: mergedOptions,
    });
    await registerAllCrons();
    res.json([redactTaskSecret(updated)]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/tasks/:id", async (req, res) => {
  try {
    await dataStore.deleteTask(req.params.id);
    nightmareSequenceGate.releaseOwner(req.params.id);
    if (typeof dataStore.deleteNightmareRunState === "function") {
      await dataStore.deleteNightmareRunState(req.params.id).catch(() => {});
    }
    await registerAllCrons();
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/tasks/:id/run", async (req, res) => {
  const task = await dataStore.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });
  if (parseTaskKeys(task).includes("nightmareChallenge")) {
    return res.status(409).json({
      error: "自动十殿不允许从定时任务列表立即执行，请到十殿配置页单队开始挑战",
    });
  }
  if (runningTasks.has(task.id)) {
    return res.status(409).json({ error: "任务正在执行" });
  }
  executeTask(task, { source: "nas-manual" }).catch((err) =>
    addLog("ERROR", "api", `手动执行失败: ${err.message}`),
  );
  res.json({ status: "running", task: task.name });
});

app.post("/api/tasks/:id/run-once", async (req, res) => {
  const task = await dataStore.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });
  if (!task.enabled) {
    return res.json({ status: "skipped", reason: "task_disabled" });
  }
  if (runningTasks.has(task.id)) {
    return res.status(409).json({ error: "任务正在执行" });
  }
  if (
    task.last_run_at &&
    shanghaiDateKey(new Date(task.last_run_at)) === shanghaiDateKey()
  ) {
    return res.json({ status: "skipped", reason: "already_run_today" });
  }

  executeTask(task, { source: "nas-scheduler" }).catch((err) =>
    addLog("ERROR", "scheduler", `定时兜底执行失败: ${err.message}`, {
      taskId: task.id,
    }),
  );
  res.json({ status: "running", task: task.name });
});

app.post("/api/tasks/:id/run-if-due", async (req, res) => {
  const minIntervalMinutes = Math.max(
    Number.parseInt(req.query.minIntervalMinutes) || 285,
    60,
  );
  const task = await dataStore.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });
  if (!task.enabled) {
    return res.json({ status: "skipped", reason: "task_disabled" });
  }
  if (runningTasks.has(task.id)) {
    return res.status(409).json({ error: "任务正在执行" });
  }
  if (
    task.last_run_at &&
    Date.now() - new Date(task.last_run_at).getTime() <
      minIntervalMinutes * 60 * 1000
  ) {
    return res.json({ status: "skipped", reason: "interval_not_elapsed" });
  }

  executeTask(task, { source: "nas-scheduler" }).catch((err) =>
    addLog("ERROR", "scheduler", `间隔任务兜底执行失败: ${err.message}`, {
      taskId: task.id,
    }),
  );
  res.json({ status: "running", task: task.name });
});

app.get("/api/logs", (req, res) => {
  const limit = Math.min(Number.parseInt(req.query.limit) || 100, LOG_MAX);
  res.json(logs.slice(0, limit));
});

app.get("/api/logs/db", async (req, res) => {
  const limit = Math.min(Number.parseInt(req.query.limit) || 100, 5000);
  const status =
    typeof req.query.status === "string" && req.query.status.trim()
      ? req.query.status.trim()
      : null;
  const taskId =
    typeof req.query.task_id === "string" && req.query.task_id.trim()
      ? req.query.task_id.trim()
      : null;
  const runId =
    typeof req.query.run_id === "string" && req.query.run_id.trim()
      ? req.query.run_id.trim()
      : null;
  try {
    res.json(await dataStore.listTaskLogs(limit, { status, taskId, runId }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/task-definitions", (req, res) => {
  const list = Object.entries(TASK_DEFINITIONS)
    .filter(([, definition]) => !definition.hiddenFromPicker)
    .map(([key, definition]) => ({
      key,
      name: definition.name,
      group: definition.group || "other",
      description: definition.description || "",
      commands: definition.commands?.map((command) => command.cmd) || [],
      options: definition.options || [],
      mode: definition.run ? "custom" : "commands",
    }));
  res.json(list);
});

const frontendDir = path.resolve(
  process.env.FRONTEND_DIR || path.join(__dirname, "public"),
);
const frontendIndex = path.join(frontendDir, "index.html");
if (fs.existsSync(frontendIndex)) {
  app.use(
    express.static(frontendDir, {
      index: false,
      maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
    }),
  );
  app.get("*", (req, res, next) => {
    if (req.path === "/health" || req.path.startsWith("/api/")) {
      return next();
    }
    res.sendFile(frontendIndex);
  });
}

const PORT = process.env.PORT || 3000;
let shuttingDown = false;
async function shutdownPushCheckpoint(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  addLog("INFO", "server", `收到 ${signal}，保存 NAS 推图状态后退出`);
  try {
    await pushSessionManager.checkpoint();
  } finally {
    process.exit(0);
  }
}
process.once("SIGTERM", () => {
  void shutdownPushCheckpoint("SIGTERM");
});
process.once("SIGINT", () => {
  void shutdownPushCheckpoint("SIGINT");
});

init()
  .then(() => {
    app.listen(PORT, () => {
      addLog("INFO", "server", `监听端口 ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("服务器启动失败:", error);
    process.exitCode = 1;
  });
