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
import { createDataStore } from "./lib/dataStore.js";
import { GameClient } from "./lib/gameClient.js";
import {
  runArenaFights,
  runDailyTasks,
  runResetBottles,
  runXuanwuBlessing,
} from "./lib/gameTasks.js";
import { createLoginProxyMiddleware } from "./lib/loginProxy.js";
import { formatTaskLogMessage } from "./lib/taskLogDescriptions.js";

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
app.use(express.json());

// ==================== 数据存储 ====================
const dataStore = createDataStore(process.env);

// ==================== 任务定义 ====================
const TASK_DEFINITIONS = {
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

async function executeTask(task) {
  if (!task?.id) throw new Error("任务缺少 id");
  if (runningTasks.has(task.id)) {
    addLog("WARN", "task", `任务正在执行，跳过重复调用: ${task.name}`, {
      taskId: task.id,
    });
    return false;
  }

  runningTasks.add(task.id);
  try {
    await executeTaskUnlocked(task);
    return true;
  } finally {
    runningTasks.delete(task.id);
  }
}

async function executeTaskUnlocked(task) {
  addLog("INFO", "task", `开始执行任务: ${task.name}`, { taskId: task.id });

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
    addLog("WARN", "task", "没有选中的token，跳过", { taskId: task.id });
    return;
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
    addLog("ERROR", "task", "没有选择任何任务类型", { taskId: task.id });
    return;
  }

  const taskDefinitions = [];
  for (const key of taskKeys) {
    const taskDef = TASK_DEFINITIONS[key];
    if (!taskDef) {
      addLog("WARN", "task", `未知任务类型: ${key}，跳过`, { taskId: task.id });
      continue;
    }
    taskDefinitions.push({ key, taskDef });
  }
  if (taskDefinitions.length === 0) {
    addLog("ERROR", "task", "没有有效的命令可执行", { taskId: task.id });
    return;
  }

  const allTokens = await loadTokens();
  const targetTokens = allTokens.filter((t) => tokenIds.includes(t.id));
  if (targetTokens.length === 0) {
    addLog("WARN", "task", "没有找到匹配的tokens", { taskId: task.id });
    return;
  }

  addLog("INFO", "task", `将执行于 ${targetTokens.length} 个角色`, {
    taskId: task.id,
  });

  for (const token of targetTokens) {
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
      addLog("ERROR", "task", `Token解析失败: ${token.name}`, {
        error: err.message,
      });
      continue;
    }

    tokenData.name = token.name;
    const client = new GameClient(tokenData, token.ws_url);

    try {
      await client.connect(15000);
      try {
        await client.sendWithPromise("role_getroleinfo", {}, 8000);
        await sleep(500);
      } catch (e) {
        addLog("WARN", "task", `获取角色信息失败 (${token.name})`, {
          error: e.message,
        });
      }

      for (const { taskDef } of taskDefinitions) {
        const cmdResults = taskDef.run
          ? await taskDef.run(client, { token, task })
          : await client.executeBatch(taskDef.commands, 800);

        for (const result of cmdResults) {
          const status = result.success ? "success" : "error";
          const detail =
            result.message || (result.success ? "OK" : result.error);
          const logMessage = formatTaskLogMessage({
            taskType: result.cmd,
            status,
            message: detail,
          });
          addLog(
            result.success ? "INFO" : "ERROR",
            "task",
            `[${token.name}] ${logMessage}`,
            { taskId: task.id },
          );
          await logToDb(task.id, token.name, result.cmd, status, logMessage);
        }
      }
    } catch (err) {
      const logMessage = formatTaskLogMessage({
        taskType: taskKeys.join(","),
        status: "error",
        message: err.message,
      });
      addLog("ERROR", "task", `[${token.name}] ${logMessage}`, {
        taskId: task.id,
      });
      await logToDb(
        task.id,
        token.name,
        taskKeys.join(","),
        "error",
        logMessage,
      );
    } finally {
      client.disconnect();
    }
    await sleep(2000);
  }

  await dataStore.markTaskRun(task.id);
  addLog("INFO", "task", `任务完成: ${task.name}`, { taskId: task.id });
}

async function logToDb(taskId, tokenName, taskType, status, message) {
  try {
    await dataStore.appendTaskLog({
      task_id: taskId,
      token_name: tokenName,
      task_type: taskType,
      status,
      message: message || null,
    });
  } catch (e) {
    console.error("写入日志失败:", e.message);
  }
}

// ==================== 定时任务调度 ====================
const cronJobs = new Map();

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
      () => {
        executeTask(task).catch((err) => {
          addLog("ERROR", "cron", `任务执行异常: ${task.name}`, {
            error: err.message,
          });
        });
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

  // 每天中午12点清理前一天的任务日志
  cron.schedule(
    "0 12 * * *",
    async () => {
      addLog("INFO", "cron", "执行每日日志清理...");
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        const deleted = await dataStore.deleteTaskLogsBefore(
          yesterday.toISOString(),
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
app.use(
  "/api",
  createApiKeyMiddleware(
    () => process.env.API_KEY,
    (req) => req.appUserAuthenticated,
  ),
);

app.get("/api/tokens", async (req, res) => {
  try {
    res.json(await dataStore.listTokens());
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

app.delete("/api/tokens/:id", async (req, res) => {
  try {
    await dataStore.deleteToken(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/tasks", async (req, res) => {
  try {
    res.json(await dataStore.listTasks());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/tasks", async (req, res) => {
  try {
    const cronExpr =
      req.body.cron_expr || req.body.cron_expression || req.body.cron;
    if (!cron.validate(cronExpr)) {
      return res.status(400).json({ error: "Cron 表达式无效" });
    }
    const created = await dataStore.createTask(req.body);
    registerCron(created);
    res.json([created]);
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
    if (!cron.validate(cronExpr)) {
      return res.status(400).json({ error: "Cron 表达式无效" });
    }
    const updated = await dataStore.updateTask(req.params.id, req.body);
    await registerAllCrons();
    res.json([updated]);
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
  executeTask(task).catch((err) =>
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

  executeTask(task).catch((err) =>
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

  executeTask(task).catch((err) =>
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
  const limit = Math.min(Number.parseInt(req.query.limit) || 100, 500);
  try {
    res.json(await dataStore.listTaskLogs(limit));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/task-definitions", (req, res) => {
  const list = Object.entries(TASK_DEFINITIONS).map(([key, val]) => ({
    key,
    name: val.name,
    commands: val.commands?.map((command) => command.cmd) || [],
    mode: val.run ? "custom" : "commands",
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
