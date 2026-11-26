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
import { createFailedTaskRetryScheduler } from "./lib/taskRetry.js";
import { TokenLockQueue } from "./lib/tokenLockQueue.js";
import { createTokenRefreshManager } from "./lib/tokenRefresh.js";

dotenv.config();
process.env.TZ = process.env.TZ || "Asia/Shanghai";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ==================== 工具函数 ====================
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function shanghaiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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

// ==================== 任务执行引擎 ====================
const runningTasks = new Set();
let failedTaskRetryScheduler = null;
const tokenLockQueue = new TokenLockQueue();
const manualLeaseManager = new ManualLeaseManager({
  lockQueue: tokenLockQueue,
});
const tokenRefreshManager = createTokenRefreshManager({
  dataStore,
  addLog,
});

async function executeTask(task, { source = "nas", retryAttempt = 0 } = {}) {
  if (!task?.id) throw new Error("任务缺少 id");
  if (runningTasks.has(task.id)) {
    addLog("WARN", "task", `任务正在执行，跳过重复调用: ${task.name}`, {
      taskId: task.id,
    });
    return false;
  }

  runningTasks.add(task.id);
  const runId = randomUUID();
  let result = null;
  try {
    result = await executeTaskUnlocked(task, runId, { source });
    return true;
  } finally {
    runningTasks.delete(task.id);
    if (retryAttempt === 0 && result?.failedTokenIds?.length) {
      const retry = failedTaskRetryScheduler?.schedule({
        task,
        tokenIds: result.failedTokenIds,
        source,
      });
      if (retry) {
        void logToDb(
          task.id,
          null,
          "taskRetryScheduled",
          "info",
          `${task.name}: ${retry.tokenIds.length} 个失败账号将在 ${new Date(retry.scheduledAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} 自动重试一次`,
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
  if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
    await addTaskRunLog("没有选中的token，跳过", {
      type: "warning",
      runId,
      source,
    });
    return;
  }

  const refreshSummary = await tokenRefreshManager.run({ tokenIds });
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

  // 支持多任务：selected_tasks 是数组，每个元素是 TASK_DEFINITIONS 的 key
  let taskKeys = task.selected_tasks;
  if (typeof taskKeys === "string") {
    try {
      taskKeys = JSON.parse(taskKeys);
    } catch {
      taskKeys = [];
    }
  }
  // 兼容旧字段 task_type（单个任务）
  if ((!Array.isArray(taskKeys) || taskKeys.length === 0) && task.task_type) {
    taskKeys = [task.task_type];
  }
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

  await addTaskRunLog(`=== 将执行于 ${targetTokens.length} 个角色 ===`, {
    taskType: "taskStarted",
    runId,
    source,
  });

  let taskHadErrors = false;
  const failedTokenIds = [];
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

  const runTokenAttempt = async (token) => {
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
    await addTaskRunLog(`=== 开始执行: ${token.name} ===`, {
      taskType: taskKeys.join(","),
      token,
      runId,
      source,
    });

    try {
      await client.connect(15000);
      try {
        await client.sendWithPromise("role_getroleinfo", {}, 8000);
        await sleep(500);
      } catch (e) {
        hadErrors = true;
        await addTaskRunLog(`${token.name}: 获取角色信息失败 (${e.message})`, {
          type: "warning",
          taskType: "role_getroleinfo",
          token,
          runId,
          source,
        });
      }

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
    return { hadErrors };
  };

  try {
    for (const token of targetTokens) {
      const result = await runTokenAttempt(token);
      if (result.hadErrors) {
        taskHadErrors = true;
        failedTokenIds.push(token.id);
      }
      await sleep(2000);
    }

    await dataStore.markTaskRun(task.id);
    await addTaskRunLog(`=== 定时任务执行完成: ${task.name} ===`, {
      type: taskHadErrors ? "error" : "success",
      taskType: "taskCompleted",
      runId,
      source,
    });
    return { hadErrors: taskHadErrors, failedTokenIds };
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

// ==================== 定时任务调度 ====================
const cronJobs = new Map();
const maintenanceWaitingTasks = new Set();

async function registerAllCrons() {
  for (const job of cronJobs.values()) job.stop();
  cronJobs.clear();

  let tasks = [];
  try {
    tasks = await dataStore.listTasks({ enabledOnly: true });
  } catch (error) {
    addLog("ERROR", "cron", "读取定时任务失败", { error: error.message });
    return;
  }

  for (const task of tasks) {
    registerCron(task);
  }
  addLog("INFO", "cron", `已注册 ${tasks.length} 个定时任务`);
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

app.get("/api/tasks/runtime", (req, res) => {
  const lockHolders = tokenLockQueue.snapshot();
  res.json({
    runningTaskIds: [...runningTasks],
    manualLeases: manualLeaseManager.list(),
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
    });
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
    await registerAllCrons();
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/tasks/:id/run", async (req, res) => {
  const task = await dataStore.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });
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
