import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fillHangUpTime } from "./dailyTaskState.js";
import {
  runArenaFights,
  runArenaTicketClear,
  runDailyTasks,
  runResetBottles,
  runXuanwuBlessing,
} from "./gameTasks.js";
import { runCharmPurchaseForClient } from "./nightmareRunner.js";
import { normalizeSelectedCharmSettings } from "./nightmareSettings.js";
import { detectWeeklyStoreState } from "./weeklyStore.js";

const FISH_TARGET = 320;
const ARENA_TARGET = 240;
const DEFAULT_WEIRD_TOWER_MAX_CLIMB = 100;
const LEGACY_ITEM_ID = 37007;
const LEGACY_MIN_COLLECT_MS = 60_000;
const LEGACY_FIRST_REWARD_MS = 300_000;
const LEGACY_COLLECT_SETTLE_MS = 1_500;
const TEN_DAY_FREE_GIFT_ID = 17;
const ACCOUNT_SETTINGS_DEFAULTS = {
  arenaFormation: 1,
  towerFormation: 1,
  bossFormation: 1,
  bossTimes: 2,
  claimBottle: true,
  payRecruit: true,
  openBox: true,
  arenaEnable: true,
  claimHangUp: true,
  claimEmail: true,
  blackMarketPurchase: true,
};

const DEFAULT_DREAM_PURCHASES = [
  "1-5",
  "1-6",
  "2-6",
  "2-7",
  "3-5",
  "3-6",
  "3-7",
];

const DEFAULT_BLACK_MARKET_ITEMS = [
  { itemId: 2002, discount: 10 },
  { itemId: 2003, discount: 10 },
  { itemId: 2004, discount: 10 },
  { itemId: 1012, discount: 7 },
];

const PEACH_TASK_TARGETS = {
  1: [1, 2, 3],
  2: [5, 15, 25, 35],
  3: [1, 2, 3],
  4: [1, 2, 3],
  5: [4, 8, 12],
  6: [100, 400, 800],
  7: [2, 4, 6],
  8: [5, 10, 15],
  9: [1],
  10: [1],
  11: [1],
  12: [1],
  13: [1],
  14: [1],
  15: [1],
  16: [1],
  17: [1],
  18: [1],
  19: [1],
  20: [5, 10, 15],
  21: [1, 3, 5],
  22: [1, 3, 5],
  23: [1, 3, 5],
  24: [1],
  25: [1],
  26: [1, 2, 3, 5],
  27: [1],
  28: [1, 3, 5],
  29: [5, 10, 15, 20, 25],
  30: [5, 10, 15],
  31: [1, 3, 5],
  32: [100, 150, 200],
  33: [10, 20, 30, 40],
  34: [1, 3, 5],
  35: [8, 16, 24],
  36: [10, 20, 30],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function numberOption(options, key, fallback, { min, max } = {}) {
  const raw = options?.[key];
  const parsed =
    raw === undefined || raw === null || raw === "" ? Number.NaN : Number(raw);
  let value = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  if (min !== undefined) value = Math.max(min, value);
  if (max !== undefined) value = Math.min(max, value);
  return value;
}

function stringOption(options, key, fallback = "") {
  const value = options?.[key];
  return typeof value === "string" ? value.trim() : fallback;
}

function accountSettings(token) {
  let stored = token?.daily_settings;
  if (typeof stored === "string") {
    try {
      stored = JSON.parse(stored);
    } catch {
      stored = {};
    }
  }
  return {
    ...ACCOUNT_SETTINGS_DEFAULTS,
    ...(stored && typeof stored === "object" ? stored : {}),
  };
}

function charmSettingsForTask(task) {
  const options =
    task?.options && typeof task.options === "object" ? task.options : {};
  const hasTaskTargets =
    Array.isArray(options.charmLayers) ||
    (options.charmTargets &&
      typeof options.charmTargets === "object" &&
      !Array.isArray(options.charmTargets));
  if (hasTaskTargets) {
    return normalizeSelectedCharmSettings({
      layers: options.charmLayers,
      targets: options.charmTargets,
      priority: options.charmPriority,
      pollIntervalMs: options.charmPollIntervalMs,
      pollDurationMs: options.charmPollDurationMs,
    });
  }
  return options.charm || options.nightmare?.charm;
}

function requiredNumberOption(options, key) {
  const value = Number(options?.[key]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function normalizePurchaseList(value, fallback = DEFAULT_BLACK_MARKET_ITEMS) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "number" || typeof entry === "string") {
          const itemId = Number(entry);
          return Number.isFinite(itemId) ? { itemId, discount: 10 } : null;
        }
        const itemId = Number(entry?.itemId);
        if (!Number.isFinite(itemId)) return null;
        return {
          itemId,
          discount: Math.min(10, Math.max(1, Number(entry?.discount) || 10)),
        };
      })
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const parsed = value
      .split(/[\s,，;；]+/)
      .map((part) => {
        const [id, discount] = part.split(/[:：-]/).map(Number);
        return Number.isFinite(id)
          ? {
              itemId: id,
              discount: Math.min(10, Math.max(1, discount || 10)),
            }
          : null;
      })
      .filter(Boolean);
    if (parsed.length) return parsed;
  }
  return fallback.map((entry) => ({ ...entry }));
}

function parseCodeList(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[\s,，;；]+/)
        .map((code) => code.trim())
        .filter(Boolean),
    ),
  ];
}

function getRole(response) {
  return response?.role || response?.data?.role || response?.roleInfo || {};
}

function getActivity(response) {
  return response?.activity || response?.body?.activity || response || {};
}

function pickArenaTargetId(targets) {
  const candidate =
    targets?.rankList?.[0] ||
    targets?.roleList?.[0] ||
    targets?.targets?.[0] ||
    targets?.targetList?.[0] ||
    targets?.list?.[0] ||
    targets?.[0];
  return (
    candidate?.roleId ||
    candidate?.id ||
    candidate?.targetId ||
    targets?.roleId ||
    targets?.id ||
    targets?.targetId ||
    null
  );
}

function monthTarget(target) {
  const now = new Date();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();
  return Math.min(target, Math.ceil((day / days) * target));
}

function createTokenStore(client, token) {
  const tokenId = String(token.id);
  return {
    gameTokens: [{ id: tokenId, name: token.name }],
    wsConnections: { [tokenId]: { client } },
    getWebSocketStatus: () =>
      client.connected && client.ws ? "connected" : "disconnected",
    sendGetRoleInfo: (_id, params = {}) =>
      client.sendWithPromise("role_getroleinfo", params, 15000),
    sendMessageWithPromise: (_id, cmd, params = {}, timeout = 8000) =>
      client.sendWithPromise(cmd, params, timeout),
  };
}

function createRunner(client, token, task) {
  const tokenId = String(token.id);
  const tokenStore = createTokenStore(client, token);
  const options =
    task?.options && typeof task.options === "object" ? task.options : {};
  const send = (cmd, params = {}, timeout = 8000) =>
    client.sendWithPromise(cmd, params, timeout);
  return { tokenId, tokenStore, options, send };
}

async function switchFormation(client, targetFormation) {
  const info = await client.sendWithPromise("presetteam_getinfo", {}, 5000);
  const original = Number(info?.presetTeamInfo?.useTeamId || 0);
  const target = numberOption({ formation: targetFormation }, "formation", 1, {
    min: 1,
    max: 6,
  });
  if (original > 0 && original !== target) {
    await client.sendWithPromise(
      "presetteam_saveteam",
      { teamId: target },
      5000,
    );
  }
  return { original, target, switched: original > 0 && original !== target };
}

async function restoreFormation(client, state) {
  if (!state.switched || !state.original) return;
  try {
    await client.sendWithPromise(
      "presetteam_saveteam",
      { teamId: state.original },
      5000,
    );
  } catch {
    // Keep the task result focused on the requested operation.
  }
}

async function claimPendingEvoTowerRewards(client, evoTower) {
  const towerId = Number(evoTower?.towerId || 0);
  const rewardTowerId = Number(evoTower?.rewardTowerId || 0);
  const clearedChapter = Math.floor(towerId / 10);
  let pending = Math.max(0, clearedChapter - rewardTowerId);
  let claimed = 0;
  while (pending > 0) {
    await client.sendWithPromise("evotower_claimreward", {}, 5000);
    claimed += 1;
    pending -= 1;
    await sleep(300);
  }
  return claimed;
}

async function runHangUp(client, token, task, claimReward) {
  const { tokenId, tokenStore } = createRunner(client, token, task);
  if (claimReward) {
    await client.sendWithPromise("system_claimhangupreward", {}, 5000);
    await sleep(500);
  }
  const result = await fillHangUpTime({
    tokenStore,
    tokenId,
    check: () => {
      if (!client.connected) throw new Error("WebSocket 已断开");
    },
  });
  return {
    cmd: claimReward ? "claimHangUpRewards" : "batchAddHangUpTime",
    success: result.remaining === 0,
    message: result.remaining
      ? `挂机加钟后仍有 ${result.remaining} 个空槽位`
      : "挂机助力槽位已补满",
  };
}

async function runClimbTower(client, token, task) {
  const { send } = createRunner(client, token, task);
  const settings = accountSettings(token);
  const formation = await switchFormation(
    client,
    numberOption(settings, "towerFormation", 1, { min: 1, max: 6 }),
  );
  let count = 0;
  let failures = 0;
  try {
    await send("tower_getinfo", {}, 5000).catch(() => {});
    let role = getRole(await send("role_getroleinfo", {}, 15000));
    let energy = Number(role?.tower?.energy || 0);
    while (energy > 0 && count < 100 && failures < 3) {
      try {
        await send("fight_starttower", {}, 8000);
        count += 1;
        failures = 0;
        energy -= 1;
        if (count % 5 === 0) {
          role = getRole(await send("role_getroleinfo", {}, 10000));
          energy = Math.max(0, Number(role?.tower?.energy || 0));
        }
        await sleep(800);
      } catch (error) {
        if (String(error.message).includes("1500040")) {
          const floor = Math.floor(Number(role?.tower?.id || 0) / 10);
          if (floor > 0) {
            await send("tower_claimreward", { rewardId: floor }, 5000).catch(
              () => {},
            );
          }
          await sleep(2000);
          role = getRole(await send("role_getroleinfo", {}, 10000));
          energy = Math.max(0, Number(role?.tower?.energy || 0));
          failures = 0;
        } else {
          failures += 1;
          await sleep(1500);
        }
      }
    }
    return {
      cmd: "climbTower",
      success: true,
      message: `爬塔完成，共挑战 ${count} 次`,
    };
  } finally {
    await restoreFormation(client, formation);
  }
}

async function runClimbWeirdTower(client, token, task) {
  const { options, send } = createRunner(client, token, task);
  const settings = accountSettings(token);
  const formation = await switchFormation(
    client,
    numberOption(settings, "towerFormation", 1, { min: 1, max: 6 }),
  );
  const maxClimb = numberOption(
    options,
    "weirdTowerMaxClimb",
    DEFAULT_WEIRD_TOWER_MAX_CLIMB,
    { min: 1, max: 1000 },
  );
  let count = 0;
  let failures = 0;
  try {
    const initial = await send("evotower_getinfo", {}, 5000);
    await claimPendingEvoTowerRewards(client, initial?.evoTower);
    let energy = Number(initial?.evoTower?.energy || 0);
    while (energy > 0 && count < maxClimb && failures < 3) {
      try {
        await send("evotower_readyfight", {}, 5000);
        await send("evotower_fight", { battleNum: 1, winNum: 1 }, 10000);
        count += 1;
        failures = 0;
        const info = await send("evotower_getinfo", {}, 5000);
        const taskMap = info?.evoTower?.taskClaimMap || {};
        const now = new Date();
        const dateKey =
          String(now.getFullYear()).slice(-2) +
          String(now.getMonth() + 1).padStart(2, "0") +
          String(now.getDate()).padStart(2, "0");
        for (const taskId of [1, 2, 3]) {
          if (!taskMap?.[dateKey]?.[taskId]) {
            await send("evotower_claimtask", { taskId }, 3000).catch(() => {});
          }
        }
        await claimPendingEvoTowerRewards(client, info?.evoTower);
        energy = Number(info?.evoTower?.energy || 0);
      } catch {
        failures += 1;
        await sleep(1000);
      }
    }
    return {
      cmd: "climbWeirdTower",
      success: true,
      message: `怪异塔完成，共挑战 ${count} 次`,
    };
  } finally {
    await restoreFormation(client, formation);
  }
}

let studyQuestionCache = null;

async function loadStudyQuestions() {
  if (studyQuestionCache) return studyQuestionCache;
  const candidates = [
    path.join(
      process.env.FRONTEND_DIR || path.join(process.cwd(), "public"),
      "answer.json",
    ),
    path.join(process.cwd(), "public", "answer.json"),
  ];
  for (const file of candidates) {
    try {
      const data = JSON.parse(await fs.readFile(file, "utf8"));
      studyQuestionCache = Array.isArray(data) ? data : [];
      return studyQuestionCache;
    } catch {
      // Try the next deployed frontend location.
    }
  }
  studyQuestionCache = [];
  return studyQuestionCache;
}

function findStudyAnswer(question, questions) {
  const raw = String(question || "")
    .replace(/\s+/g, "")
    .toLowerCase();
  for (const item of questions) {
    const candidate = String(item?.name || "")
      .replace(/\s+/g, "")
      .toLowerCase();
    if (
      candidate &&
      item?.value &&
      (raw.includes(candidate) || candidate.includes(raw))
    ) {
      return Number(item.value);
    }
  }
  return 1;
}

async function runStudy(client, token, task) {
  const { send } = createRunner(client, token, task);
  const response = await send("study_startgame", {}, 10000);
  const questions = await loadStudyQuestions();
  const questionList = response?.questionList || [];
  const studyId = response?.role?.study?.id;
  if (!Array.isArray(questionList) || !studyId) {
    return {
      cmd: "batchStudy",
      success: true,
      message: "本周答题已完成或当前没有可作答题目",
    };
  }
  for (const question of questionList) {
    const answer = findStudyAnswer(question.question, questions);
    client.send("study_answer", {
      id: studyId,
      option: [answer],
      questionId: [question.id],
    });
    await sleep(300);
  }
  await sleep(1000);
  for (let rewardId = 1; rewardId <= 10; rewardId += 1) {
    client.send("study_claimreward", { rewardId });
    await sleep(200);
  }
  return {
    cmd: "batchStudy",
    success: true,
    message: `自动回答 ${questionList.length} 道题并尝试领取全部奖励`,
  };
}

async function openBoxBatches(send, itemId, count) {
  let remaining = Math.max(0, count);
  let opened = 0;
  while (remaining > 0) {
    const batch = Math.min(10, remaining);
    await send("item_openbox", { itemId, number: batch }, 8000);
    opened += batch;
    remaining -= batch;
    if (remaining > 0) await sleep(300);
  }
  return opened;
}

async function runOpenBox(client, token, task) {
  const { options, send } = createRunner(client, token, task);
  const itemId = numberOption(options, "boxType", 2001);
  const count = numberOption(options, "boxCount", 100, { min: 1, max: 5000 });
  const opened = await openBoxBatches(send, itemId, count);
  await send("item_batchclaimboxpointreward", {}, 5000).catch(() => {});
  return {
    cmd: "batchOpenBox",
    success: true,
    message: `开启宝箱 ${opened} 个并尝试领取宝箱积分`,
  };
}

async function runClaimBoxPoints(client, token, task) {
  const { send } = createRunner(client, token, task);
  await send("item_batchclaimboxpointreward", {}, 5000);
  return {
    cmd: "batchClaimBoxPointReward",
    success: true,
    message: "宝箱积分已领取",
  };
}

async function runOpenBoxByPoints(client, token, task) {
  const { options, send } = createRunner(client, token, task);
  const targetPoints = numberOption(options, "targetBoxPoints", 1000, {
    min: 10,
    max: 10000,
  });
  const role = getRole(await send("role_getroleinfo", {}, 10000));
  const inventory = {
    2001: Number(role?.items?.[2001]?.quantity || 0),
    2002: Number(role?.items?.[2002]?.quantity || 0),
    2003: Number(role?.items?.[2003]?.quantity || 0),
    2004: Number(role?.items?.[2004]?.quantity || 0),
  };
  const points = { 2001: 1, 2002: 10, 2003: 20, 2004: 50 };
  const total = Object.entries(inventory).reduce(
    (sum, [id, count]) => sum + count * points[id],
    0,
  );
  if (total < targetPoints) {
    throw new Error(
      `可获得的宝箱积分不足：需要 ${targetPoints}，当前最多 ${total}`,
    );
  }
  let remaining = targetPoints;
  const plan = {};
  for (const id of [2004, 2003, 2002]) {
    const available = Math.floor(inventory[id] / 10) * 10;
    const useful = Math.min(available, Math.floor(remaining / points[id]) * 10);
    if (useful > 0) {
      plan[id] = useful;
      remaining -= useful * points[id];
    }
  }
  if (remaining > 0) {
    const woodenAvailable =
      Math.floor(Math.max(0, inventory[2001] - 200) / 10) * 10;
    plan[2001] = Math.min(woodenAvailable, Math.ceil(remaining) * 10);
  }
  let opened = 0;
  for (const id of [2001, 2002, 2003, 2004]) {
    if (plan[id]) opened += await openBoxBatches(send, id, plan[id]);
  }
  await send("item_batchclaimboxpointreward", {}, 5000).catch(() => {});
  return {
    cmd: "batchOpenBoxByPoints",
    success: true,
    message: `按积分开箱完成，目标 ${targetPoints} 分，共开启 ${opened} 个`,
  };
}

async function runFish(client, token, task) {
  const { options, send } = createRunner(client, token, task);
  const type = numberOption(options, "fishType", 1, { min: 1, max: 2 });
  const requested = numberOption(options, "fishCount", 100, {
    min: 1,
    max: 5000,
  });
  const role = getRole(await send("role_getroleinfo", {}, 10000));
  const rodId = type === 1 ? 1011 : 1012;
  let remaining = Math.min(
    requested,
    Number(role?.items?.[rodId]?.quantity || 0),
  );
  let used = 0;
  while (remaining > 0) {
    const batch = Math.min(10, remaining);
    await send(
      "artifact_lottery",
      { type, lotteryNumber: batch, newFree: true },
      10000,
    );
    used += batch;
    remaining -= batch;
    await sleep(300);
  }
  const refreshedRole = getRole(
    await send("role_getroleinfo", {}, 10000).catch(() => role),
  );
  const points = Number(refreshedRole?.statistics?.["artifact:point"] || 0);
  const exchanges = Math.floor(points / 20);
  for (let index = 0; index < exchanges; index += 1) {
    try {
      await send("artifact_exchange", {}, 5000);
    } catch {
      break;
    }
  }
  return {
    cmd: "batchFish",
    success: true,
    message: `钓鱼 ${used} 次，尝试领取 ${exchanges} 次累计奖励`,
  };
}

async function runRecruit(client, token, task) {
  const { options, send } = createRunner(client, token, task);
  const count = numberOption(options, "recruitCount", 100, {
    min: 1,
    max: 5000,
  });
  let remaining = count;
  while (remaining > 0) {
    const batch = Math.min(10, remaining);
    await send("hero_recruit", { recruitType: 1, recruitNumber: batch }, 10000);
    remaining -= batch;
    if (remaining > 0) await sleep(300);
  }
  return {
    cmd: "batchRecruit",
    success: true,
    message: `批量招募完成，共 ${count} 次`,
  };
}

async function runRedeemCodes(client, token, task) {
  const { options, send } = createRunner(client, token, task);
  const codes = parseCodeList(options.redeemCodes);
  if (!codes.length) throw new Error("请先填写兑换码");
  const platformType = stringOption(options, "platformType", "h5") || "h5";
  let success = 0;
  let failed = 0;
  for (const key of codes) {
    try {
      await send("system_claimcdkreward", { key, platformType }, 8000);
      success += 1;
    } catch {
      failed += 1;
    }
    await sleep(300);
  }
  return {
    cmd: "batchRedeemCodes",
    success: failed === 0,
    message: `兑换码处理完成：成功 ${success}，失败 ${failed}`,
  };
}

async function runDungeonFloor(client, token, task, highFloors) {
  const { send } = createRunner(client, token, task);
  const info = await send("bosstower_getinfo", {}, 8000);
  const towerId = Number(info?.bossTower?.towerId || 0);
  const inRange = highFloors
    ? towerId >= 4 && towerId <= 5
    : towerId >= 1 && towerId <= 3;
  if (!inRange) {
    return {
      cmd: highFloors ? "batchbaoku45" : "batchbaoku13",
      success: true,
      message: `当前宝库层数 ${towerId || "未知"}，无需执行该分层任务`,
    };
  }
  for (let index = 0; index < 2; index += 1) {
    await send("bosstower_startboss", {}, 10000);
    await sleep(500);
  }
  if (!highFloors) {
    for (let index = 0; index < 9; index += 1) {
      await send("bosstower_startbox", {}, 8000);
      await sleep(500);
    }
  }
  return {
    cmd: highFloors ? "batchbaoku45" : "batchbaoku13",
    success: true,
    message: highFloors
      ? `宝库第 ${towerId} 层已执行 2 次挑战`
      : `宝库前 3 层已执行挑战和开箱`,
  };
}

async function runDream(client, token, task) {
  const { send } = createRunner(client, token, task);
  const day = new Date().getDay();
  if (![0, 1, 3, 4].includes(day)) {
    return {
      cmd: "batchmengjing",
      success: true,
      message: "当前不在梦境开放日，已跳过",
    };
  }
  await send("dungeon_selecthero", { battleTeam: { 0: 107 } }, 8000);
  return { cmd: "batchmengjing", success: true, message: "梦境挑战队伍已选择" };
}

async function runBuyDreamItems(client, token, task) {
  const { options, send } = createRunner(client, token, task);
  const day = new Date().getDay();
  if (![0, 1, 3, 4].includes(day)) {
    return {
      cmd: "batchBuyDreamItems",
      success: true,
      message: "当前不在梦境开放日，已跳过",
    };
  }
  const configured = Array.isArray(options.dreamPurchaseList)
    ? options.dreamPurchaseList
    : String(options.dreamPurchaseList || DEFAULT_DREAM_PURCHASES.join(","))
        .split(/[\s,，;；]+/)
        .filter(Boolean);
  const role = getRole(await send("role_getroleinfo", {}, 15000));
  if (Number(role.levelId || 0) < 4000) {
    throw new Error("主线关卡低于 4000，无法购买梦境商品");
  }
  const merchant = role?.dungeon?.merchant || {};
  const operations = [];
  for (const key of configured) {
    const [merchantId, index] = String(key).split("-").map(Number);
    const items = merchant?.[merchantId];
    if (!Array.isArray(items)) continue;
    items.forEach((itemIndex, pos) => {
      if (itemIndex === index) operations.push({ merchantId, index, pos });
    });
  }
  operations.sort((left, right) =>
    left.merchantId === right.merchantId
      ? right.pos - left.pos
      : left.merchantId - right.merchantId,
  );
  let success = 0;
  let failed = 0;
  for (const operation of operations) {
    try {
      await send(
        "dungeon_buymerchant",
        {
          id: operation.merchantId,
          index: operation.index,
          pos: operation.pos,
        },
        8000,
      );
      success += 1;
    } catch {
      failed += 1;
    }
    await sleep(500);
  }
  return {
    cmd: "batchBuyDreamItems",
    success: failed === 0,
    message: `梦境购买完成：成功 ${success}，失败 ${failed}`,
  };
}

async function runGenieSweep(client, token, task) {
  const { send } = createRunner(client, token, task);
  const role = getRole(await send("role_getroleinfo", {}, 10000));
  let tickets = Number(role?.items?.[1021]?.quantity || 0);
  if (tickets <= 0) {
    return {
      cmd: "batchGenieSweep",
      success: true,
      message: "扫荡券不足，已跳过",
    };
  }
  const genie = role?.genie || {};
  let bestGenieId = 1;
  let bestLayer = -1;
  for (let id = 1; id <= 4; id += 1) {
    if (genie[id] !== undefined) {
      const layer = Number(genie[id]) + 1;
      if (layer > bestLayer) {
        bestLayer = layer;
        bestGenieId = id;
      }
    }
  }
  let swept = 0;
  while (tickets > 0 && swept < 2000) {
    const sweepCnt = Math.min(20, tickets);
    const result = await send(
      "genie_sweep",
      { genieId: bestGenieId, sweepCnt },
      10000,
    );
    swept += sweepCnt;
    tickets = Number(result?.role?.items?.[1021]?.quantity ?? 0);
  }
  return {
    cmd: "batchGenieSweep",
    success: true,
    message: `灯神扫荡完成，共 ${swept} 次`,
  };
}

async function runPeachTasks(client, token, task) {
  const { send } = createRunner(client, token, task);
  let response = await send("legion_getpayloadtask", {}, 8000);
  let payload = response?.payloadTask || response?.data?.payloadTask;
  if (!payload?.taskMap) {
    return {
      cmd: "batchClaimPeachTasks",
      success: true,
      message: "当前没有可读取的蟠桃园任务",
    };
  }
  let claimed = 0;
  const claimedIds = new Set();
  for (const [taskId, item] of Object.entries(payload.taskMap)) {
    const thresholds = PEACH_TASK_TARGETS[Number(item?.typ)] || [];
    const progress = Number(item?.progress || 0);
    const claimedProgress = Number(item?.claimedProgress || 0);
    if (
      thresholds.some(
        (target) => progress >= target && claimedProgress < target,
      )
    ) {
      try {
        await send("legion_claimpayloadtask", { taskId: Number(taskId) }, 5000);
        claimed += 1;
        claimedIds.add(taskId);
      } catch {
        // Keep claiming other available task rewards.
      }
    }
  }
  response = await send("legion_getpayloadtask", {}, 8000);
  payload = response?.payloadTask || response?.data?.payloadTask || payload;
  for (const taskGroup of [1, 2]) {
    try {
      await send("legion_claimpayloadtaskprogress", { taskGroup }, 5000);
    } catch {
      // No claimable point milestone for this group.
    }
  }
  return {
    cmd: "batchClaimPeachTasks",
    success: true,
    message: `蟠桃园任务奖励处理完成，领取 ${claimed} 项`,
  };
}

async function runTopUpFish(client, token, task) {
  const { send } = createRunner(client, token, task);
  const activity = getActivity(await send("activity_get", {}, 10000));
  const current = Number(activity?.myMonthInfo?.["2"]?.num || 0);
  const target = monthTarget(FISH_TARGET);
  let needed = Math.max(0, target - current);
  if (needed <= 0) {
    return {
      cmd: "batchTopUpFish",
      success: true,
      message: `钓鱼进度 ${current}/${FISH_TARGET}，当前已达标`,
    };
  }
  let role = getRole(await send("role_getroleinfo", {}, 10000));
  const lastFreeTime = Number(
    role?.statisticsTime?.["artifact:normal:lottery:time"] || 0,
  );
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  if (!lastFreeTime || lastFreeTime < dayStart.getTime() / 1000) {
    for (let index = 0; index < 3 && needed > 0; index += 1) {
      try {
        await send(
          "artifact_lottery",
          { lotteryNumber: 1, newFree: true, type: 1 },
          8000,
        );
        needed -= 1;
      } catch {
        break;
      }
    }
  }
  role = getRole(await send("role_getroleinfo", {}, 10000));
  let rods = Number(role?.items?.[1011]?.quantity || 0);
  let used = 0;
  while (needed > 0 && rods > 0) {
    const batch = Math.min(10, needed, rods);
    await send(
      "artifact_lottery",
      { lotteryNumber: batch, newFree: true, type: 1 },
      12000,
    );
    needed -= batch;
    rods -= batch;
    used += batch;
    await sleep(500);
  }
  return {
    cmd: "batchTopUpFish",
    success: true,
    message: `钓鱼补齐使用 ${used} 根普通鱼竿，仍需 ${needed} 次`,
  };
}

async function runTopUpArena(client, token, task) {
  const { send } = createRunner(client, token, task);
  const settings = accountSettings(token);
  const activity = getActivity(await send("activity_get", {}, 10000));
  const current = Number(activity?.myArenaInfo?.num || 0);
  const target = monthTarget(ARENA_TARGET);
  let needed = Math.max(0, target - current);
  if (needed <= 0) {
    return {
      cmd: "batchTopUpArena",
      success: true,
      message: `竞技场进度 ${current}/${ARENA_TARGET}，当前已达标`,
    };
  }
  const formation = await switchFormation(
    client,
    numberOption(settings, "arenaFormation", 1, { min: 1, max: 6 }),
  );
  let fought = 0;
  try {
    await send("arena_startarea", {}, 6000).catch(() => {});
    while (needed > 0 && fought < 100) {
      const role = getRole(await send("role_getroleinfo", {}, 10000));
      const tickets = Number(role?.items?.[1007]?.quantity || 0);
      if (tickets <= 0) break;
      const targets = await send("arena_getareatarget", {}, 8000).catch(
        () => null,
      );
      const targetId = pickArenaTargetId(targets);
      if (!targetId) break;
      await send("fight_startareaarena", { targetId }, 15000);
      fought += 1;
      needed -= 2;
      await sleep(500);
    }
    const finalActivity = getActivity(await send("activity_get", {}, 10000));
    const finalCount = Number(
      finalActivity?.myArenaInfo?.num || current + fought * 2,
    );
    return {
      cmd: "batchTopUpArena",
      success: true,
      message: `竞技场补齐战斗 ${fought} 次，进度 ${finalCount}/${ARENA_TARGET}`,
    };
  } finally {
    await restoreFormation(client, formation);
  }
}

async function runFreeEnergy(client, token, task) {
  const { send } = createRunner(client, token, task);
  const info = await send("mergebox_getinfo", { actType: 1 }, 8000);
  const freeEnergy = Number(info?.mergeBox?.freeEnergy || 0);
  if (freeEnergy <= 0) {
    return {
      cmd: "batchClaimFreeEnergy",
      success: true,
      message: "当前没有可领取的怪异塔免费道具",
    };
  }
  await send("mergebox_claimfreeenergy", { actType: 1 }, 5000);
  return {
    cmd: "batchClaimFreeEnergy",
    success: true,
    message: `领取怪异塔免费道具 ${freeEnergy} 个`,
  };
}

async function runUseWeirdTowerItems(client, token, task) {
  const { send } = createRunner(client, token, task);
  const info = await send("mergebox_getinfo", { actType: 1 }, 5000);
  const tower = await send("evotower_getinfo", {}, 5000);
  let cost = Number(info?.mergeBox?.costTotalCnt || 0);
  let remaining = Number(tower?.evoTower?.lotteryLeftCnt || 0);
  let used = 0;
  while (remaining > 0) {
    const pos =
      cost < 2
        ? { gridX: 4, gridY: 5 }
        : cost < 102
          ? { gridX: 7, gridY: 3 }
          : { gridX: 6, gridY: 3 };
    await send("mergebox_openbox", { actType: 1, pos }, 8000);
    cost += 1;
    remaining -= 1;
    used += 1;
    await sleep(400);
  }
  await send("mergebox_claimcostprogress", { actType: 1 }, 5000).catch(
    () => {},
  );
  return {
    cmd: "batchUseItems",
    success: true,
    message: `怪异塔道具使用完成，共 ${used} 次`,
  };
}

function collectMergeItems(gridMap) {
  const groups = {};
  for (const [xText, column] of Object.entries(gridMap || {})) {
    for (const [yText, item] of Object.entries(column || {})) {
      if (
        Number(item?.gridConfId || 0) === 0 &&
        Number(item?.gridItemId || 0) > 0 &&
        !item?.isLock
      ) {
        const id = Number(item.gridItemId);
        groups[id] ||= [];
        groups[id].push({ x: Number(xText), y: Number(yText) });
      }
    }
  }
  return groups;
}

function isPermanentWeirdTowerSkip(error) {
  return String(error?.message || error || "").includes("200160");
}

async function runWeirdTowerMergeRound(send) {
  let info;
  try {
    info = await send("mergebox_getinfo", { actType: 1 }, 5000);
  } catch (error) {
    if (isPermanentWeirdTowerSkip(error)) {
      return {
        ok: false,
        unavailable: true,
        merged: false,
        claimed: false,
      };
    }
    return { ok: false, merged: false, claimed: false };
  }
  if (!info?.mergeBox) {
    return { ok: false, merged: false, claimed: false };
  }

  let claimed = false;
  for (const taskId of Object.keys(info.mergeBox.taskMap || {})) {
    if (
      Number(info.mergeBox.taskMap[taskId] || 0) !== 0 &&
      !info.mergeBox.taskClaimMap?.[taskId]
    ) {
      try {
        await send(
          "mergebox_claimmergeprogress",
          { actType: 1, taskId: Number(taskId) },
          3000,
        );
        claimed = true;
      } catch (error) {
        if (isPermanentWeirdTowerSkip(error)) {
          return {
            ok: false,
            unavailable: true,
            merged: false,
            claimed,
          };
        }
      }
      await sleep(300);
    }
  }

  const groups = collectMergeItems(info.mergeBox.gridMap);
  if (!Object.values(groups).some((items) => items.length >= 2)) {
    return { ok: true, merged: false, claimed };
  }

  const level8 = Number(info.mergeBox.taskMap?.["251212208"] || 0) !== 0;
  if (level8) {
    try {
      await send("mergebox_automergeitem", { actType: 1 }, 10000);
      await sleep(1200);
      return { ok: true, merged: true, claimed };
    } catch (error) {
      if (isPermanentWeirdTowerSkip(error)) {
        return {
          ok: false,
          unavailable: true,
          merged: false,
          claimed,
        };
      }
      return { ok: true, merged: false, claimed };
    }
  }

  let merged = false;
  for (const items of Object.values(groups)) {
    while (items.length >= 2) {
      const source = items.shift();
      const target = items.shift();
      try {
        await send(
          "mergebox_mergeitem",
          {
            actType: 1,
            sourcePos: { gridX: source.x, gridY: source.y },
            targetPos: { gridX: target.x, gridY: target.y },
          },
          3000,
        );
        merged = true;
      } catch (error) {
        if (isPermanentWeirdTowerSkip(error)) {
          return {
            ok: false,
            unavailable: true,
            merged,
            claimed,
          };
        }
      }
      await sleep(250);
    }
  }
  return { ok: true, merged, claimed };
}

async function runMergeWeirdTowerItems(client, token, task) {
  const { send } = createRunner(client, token, task);
  let mergedRounds = 0;
  for (let round = 0; round < 20; round += 1) {
    const result = await runWeirdTowerMergeRound(send);
    if (result.unavailable) {
      return {
        cmd: "batchMergeItems",
        success: true,
        status: "warning",
        message: "怪异塔合成模块未开启，已跳过",
      };
    }
    if (!result.ok) throw new Error("获取合成盒子信息失败");
    if (!result.merged && !result.claimed) break;
    mergedRounds += 1;
    await sleep(500);
  }
  return {
    cmd: "batchMergeItems",
    success: true,
    message: `怪异塔合成完成，共处理 ${mergedRounds} 轮`,
  };
}

async function runUseAndMergeWeirdTowerItems(client, token, task) {
  const { send } = createRunner(client, token, task);
  let totalUsed = 0;
  let mergeRounds = 0;
  let consecutiveErrors = 0;
  let stallRounds = 0;
  let aborted = false;
  const maxRounds = 50;
  const maxConsecutiveErrors = 3;

  try {
    const freeInfo = await send("mergebox_getinfo", { actType: 1 }, 5000);
    if (Number(freeInfo?.mergeBox?.freeEnergy || 0) > 0) {
      await send("mergebox_claimfreeenergy", { actType: 1 }, 5000).catch(
        () => {},
      );
    }
  } catch (error) {
    if (isPermanentWeirdTowerSkip(error)) {
      return {
        cmd: "batchUseAndMergeItems",
        success: true,
        status: "warning",
        message: "怪异塔模块未开启，已跳过",
      };
    }
  }

  for (let round = 0; round < maxRounds; round += 1) {
    let tower;
    try {
      tower = await send("evotower_getinfo", {}, 5000);
      consecutiveErrors = 0;
    } catch (error) {
      if (isPermanentWeirdTowerSkip(error)) {
        return {
          cmd: "batchUseAndMergeItems",
          success: true,
          status: "warning",
          message: "怪异塔模块未开启，已跳过",
        };
      }
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error("连续读取怪异塔信息失败");
      }
      await sleep(500);
      continue;
    }

    let remaining = Number(tower?.evoTower?.lotteryLeftCnt || 0);
    let info;
    try {
      info = await send("mergebox_getinfo", { actType: 1 }, 5000);
    } catch (error) {
      if (isPermanentWeirdTowerSkip(error)) {
        return {
          cmd: "batchUseAndMergeItems",
          success: true,
          status: "warning",
          message: "怪异塔合成模块未开启，已跳过",
        };
      }
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error("连续读取合成盒信息失败");
      }
      await sleep(500);
      continue;
    }
    let cost = Number(info?.mergeBox?.costTotalCnt || 0);
    let usedThisRound = 0;
    let openFailed = false;

    while (remaining > 0) {
      const pos =
        cost < 2
          ? { gridX: 4, gridY: 5 }
          : cost < 102
            ? { gridX: 7, gridY: 3 }
            : { gridX: 6, gridY: 3 };
      try {
        await send("mergebox_openbox", { actType: 1, pos }, 8000);
        cost += 1;
        remaining -= 1;
        totalUsed += 1;
        usedThisRound += 1;
        consecutiveErrors = 0;
        await sleep(400);
      } catch (error) {
        if (isPermanentWeirdTowerSkip(error)) {
          return {
            cmd: "batchUseAndMergeItems",
            success: true,
            status: "warning",
            message: "怪异塔合成模块未开启，已跳过",
          };
        }
        openFailed = true;
        break;
      }
    }

    mergeRounds += 1;
    const mergeResult = await runWeirdTowerMergeRound(send);
    if (mergeResult.unavailable) {
      return {
        cmd: "batchUseAndMergeItems",
        success: true,
        status: "warning",
        message: "怪异塔合成模块未开启，已跳过",
      };
    }
    await send("mergebox_claimcostprogress", { actType: 1 }, 5000).catch(
      () => {},
    );

    if (usedThisRound > 0) {
      stallRounds = 0;
    } else {
      stallRounds += 1;
    }
    if (usedThisRound === 0 && !mergeResult.merged) {
      if (!openFailed) break;
      if (stallRounds >= maxConsecutiveErrors) {
        aborted = true;
        break;
      }
    }
    await sleep(500);
  }

  return {
    cmd: "batchUseAndMergeItems",
    success: !aborted,
    status: aborted ? "error" : undefined,
    message: aborted
      ? `怪异塔连续 ${maxConsecutiveErrors} 轮无法使用道具且合成无进展，已停止；已使用 ${totalUsed} 个钥匙`
      : `怪异塔领取+使用+合成完成：使用钥匙 ${totalUsed} 个，合成 ${mergeRounds} 轮`,
  };
}

async function runSkinChallenge(client, token, task) {
  const { send } = createRunner(client, token, task);
  const date = new Date();
  const friday = new Date(date);
  friday.setHours(0, 0, 0, 0);
  friday.setDate(friday.getDate() - ((friday.getDay() - 5 + 7) % 7));
  const actId = Number(
    `${String(friday.getFullYear()).slice(-2)}${String(
      friday.getMonth() + 1,
    ).padStart(2, "0")}${String(friday.getDate()).padStart(2, "0")}1`,
  );
  let info = await send("towers_getinfo", { actId }, 8000);
  info = info?.towerData || info;
  const openMap = {
    5: [1],
    6: [2],
    0: [3],
    1: [4],
    2: [5],
    3: [6],
    4: [1, 2, 3, 4, 5, 6],
  };
  const open = openMap[date.getDay()] || [];
  const cleared = (type) =>
    Boolean(
      info?.levelRewardMap?.[`${type}008`] ||
      info?.levelRewardMap?.[Number(`${type}008`)],
    );
  let fights = 0;
  for (const type of open.filter((item) => !cleared(item))) {
    let failures = 0;
    let needStart = true;
    while (failures < 3) {
      if (needStart) {
        await send("towers_start", { actId, towerType: type }, 5000);
        needStart = false;
      }
      const fight = await send(
        "towers_fight",
        { actId, towerType: type },
        8000,
      );
      fights += 1;
      if (Number(fight?.battleData?.result?.accept?.ext?.curHP) === 0) {
        info = (await send("towers_getinfo", { actId }, 5000))?.towerData || {};
        if (cleared(type)) break;
      } else {
        needStart = true;
        failures += 1;
      }
      await sleep(500);
    }
  }
  const claimActId = Number(String(actId).endsWith("1"))
    ? Number(actId) + 1
    : Number(actId);
  for (let index = 0; index < 20; index += 1) {
    try {
      await send("activity_startactegame", { actId: claimActId }, 5000);
    } catch {
      break;
    }
  }
  return {
    cmd: "skinChallenge",
    success: true,
    message: `换皮闯关完成，共战斗 ${fights} 次`,
  };
}

async function runBuyLegionGoods(client, token, task) {
  const { send } = createRunner(client, token, task);
  await send("legion_storebuygoods", { id: 6 }, 8000);
  return {
    cmd: "legion_storebuygoods",
    success: true,
    message: "已购买四圣碎片",
  };
}

function normalizeMarketItems(options) {
  return normalizePurchaseList(
    options.blackMarketPurchaseList,
    DEFAULT_BLACK_MARKET_ITEMS,
  );
}

async function readBlackMarketConfig(send) {
  const result = await send("store_getpurchase", {}, 8000);
  return {
    purchaseCnt: Math.max(1, Number(result?.purchaseCnt || 1)),
    items: normalizePurchaseList(result?.purchaseItemList || [], []),
  };
}

async function runSyncBlackMarket(client, token, task) {
  const { options, send } = createRunner(client, token, task);
  const configured = normalizeMarketItems(options);
  if (!configured.length) throw new Error("未配置黑市采购清单");
  const current = await readBlackMarketConfig(send);
  if (JSON.stringify(current.items) !== JSON.stringify(configured)) {
    await send(
      "store_setpurchase",
      {
        purchaseCnt: current.purchaseCnt,
        purchaseItemList: configured,
      },
      8000,
    );
  }
  const verified = await readBlackMarketConfig(send);
  if (JSON.stringify(verified.items) !== JSON.stringify(configured)) {
    throw new Error("黑市采购清单写入后校验失败");
  }
  return {
    cmd: "store_syncpurchaseconfig",
    success: true,
    message: `黑市采购清单已同步 ${configured.length} 项`,
  };
}

async function runBlackMarketPurchase(client, token, task) {
  const { send } = createRunner(client, token, task);
  await send("store_purchase", {}, 8000);
  return {
    cmd: "store_purchase",
    success: true,
    message: "黑市采购完成",
  };
}

async function buildCampTeam(client, formationId = 1) {
  const [preset, roleResponse] = await Promise.all([
    client.sendWithPromise("presetteam_getinfo", {}, 5000),
    client.sendWithPromise("role_getroleinfo", {}, 15000),
  ]);
  const root =
    preset?.presetTeamInfo?.presetTeamInfo || preset?.presetTeamInfo || {};
  const formation = root[String(formationId)] || root["1"] || {};
  const battleTeam = {};
  for (const [position, hero] of Object.entries(formation.teamInfo || {})) {
    const heroId = hero?.heroId ?? hero?.id;
    if (heroId) battleTeam[position] = Number(heroId);
  }
  if (!Object.keys(battleTeam).length) {
    throw new Error(`无法读取阵容${formationId}`);
  }
  return {
    lordWeaponId: getRole(roleResponse)?.lordWeaponId || 0,
    petUId: "",
    battleTeam,
  };
}

async function runCampChallenge(client, token, task, { pet = false } = {}) {
  const settings = accountSettings(token);
  const teamSetParams = await buildCampTeam(
    client,
    numberOption(settings, "arenaFormation", 1, { min: 1, max: 6 }),
  );
  let attacks = 0;
  if (pet) {
    for (let round = 0; round < 3; round += 1) {
      try {
        await client.sendWithPromise(
          "club_attackmonster",
          { useItem: false, teamSetParams },
          10000,
        );
        attacks += 1;
        await sleep(500);
      } catch {
        break;
      }
    }
  } else {
    const info = await client.sendWithPromise("club_getinfo", {}, 10000);
    const opponents = Object.values(info?.club?.oppoMap || {});
    const targets = [];
    for (const opponent of opponents) {
      for (const [nodeId, defender] of Object.entries(
        opponent?.defenders || {},
      )) {
        if (!defender?.defeated) {
          targets.push({ opponent, nodeId, defender });
        }
      }
    }
    targets.sort(() => Math.random() - 0.5);
    for (const target of targets.slice(0, 3)) {
      try {
        await client.sendWithPromise(
          "club_gettargetteam",
          { targetId: target.defender.roleId },
          5000,
        );
        await client.sendWithPromise(
          "club_attack",
          {
            nodeId: Number(target.nodeId),
            targetId: target.defender.roleId,
            challengeCnt: target.defender.challengeCnt || 0,
            failCnt: target.defender.failCnt || 0,
            useItem: false,
            teamSetParams,
          },
          10000,
        );
        attacks += 1;
      } catch {
        // Continue with the remaining available defenders.
      }
      await sleep(500);
    }
  }
  await runCampTaskClaims(client, token, task);
  return {
    cmd: pet ? "batchCampChallengePet" : "batchCampChallenge",
    success: true,
    message: pet
      ? `营地宠物挑战完成，共 ${attacks} 次`
      : `营地挑战完成，共 ${attacks} 次`,
  };
}

async function runCampTaskClaims(client, token, task) {
  const { send } = createRunner(client, token, task);
  await send("club_getinfo", {}, 10000).catch(() => {});
  let claimed = 0;
  for (const confId of [1, 2, 3, 4]) {
    try {
      await send("club_taskclaim", { confId }, 5000);
      claimed += 1;
    } catch {
      // Already claimed or not yet available.
    }
  }
  return {
    cmd: "batchCampClaimTasks",
    success: true,
    message: `营地任务奖励领取完成，共 ${claimed} 项`,
  };
}

function extractLegionId(response) {
  const role = getRole(response);
  return Number(
    role?.legionId ??
      role?.legionID ??
      role?.clubId ??
      role?.clubID ??
      role?.guildId ??
      0,
  );
}

async function runApplyLegion(client, token, task) {
  const { options, send } = createRunner(client, token, task);
  const legionId = requiredNumberOption(options, "legionId");
  if (!legionId) throw new Error("请填写目标俱乐部 ID");
  const roleResponse = await send("role_getroleinfo", {}, 10000);
  const currentLegionId = extractLegionId(roleResponse);
  if (currentLegionId) {
    return {
      cmd: "batchApplyLegion",
      success: true,
      message:
        currentLegionId === legionId
          ? `已在目标俱乐部 ${legionId} 中`
          : `已加入其他俱乐部 ${currentLegionId}，未重复申请`,
    };
  }
  const target = await send("legion_getinfobyid", { legionId }, 8000);
  const info = target?.legionData || target?.info || target?.legionInfo;
  if (!info) throw new Error("未查询到目标俱乐部");
  await send("legion_applyjoin", { legionId }, 8000);
  return {
    cmd: "batchApplyLegion",
    success: true,
    message: `已申请加入俱乐部 ${info.name || legionId}`,
  };
}

export async function claimLegacyHangUp(
  client,
  {
    minCollectMs = LEGACY_MIN_COLLECT_MS,
    firstRewardMs = LEGACY_FIRST_REWARD_MS,
    settleMs = LEGACY_COLLECT_SETTLE_MS,
    wait = sleep,
    now = Date.now,
    deferUntilReady = false,
  } = {},
) {
  const info = await client.sendWithPromise("legacy_getinfo", {}, 8000);
  let hangUpBeginTime = Number(info?.roleLegacy?.hangUpBeginTime || 0);
  let produceItemCnt = Number(info?.roleLegacy?.produceItemCnt || 0);
  let startedNow = false;

  if (hangUpBeginTime <= 0) {
    const started = await client.sendWithPromise(
      "legacy_beginhangup",
      {},
      8000,
    );
    hangUpBeginTime = Number(
      started?.roleLegacy?.hangUpBeginTime || client.serverTime || now(),
    );
    produceItemCnt = Number(started?.roleLegacy?.produceItemCnt || 0);
    startedNow = true;
  }

  const serverNow = Number(client.serverTime || now());
  const elapsedMs = Math.max(0, serverNow - hangUpBeginTime);
  const readyAfterMs = Math.max(minCollectMs, firstRewardMs) + settleMs;
  const waitMs = produceItemCnt > 0 ? 0 : Math.max(0, readyAfterMs - elapsedMs);
  if (waitMs > 0) {
    if (deferUntilReady) {
      return { startedNow, deferred: true, waitMs, claim: null };
    }
    await wait(waitMs);
  }

  let claim;
  try {
    claim = await client.sendWithPromise("legacy_claimhangup", {}, 8000);
  } catch (error) {
    if (String(error?.message).includes("12400000")) {
      return {
        startedNow,
        deferred: false,
        rateLimited: true,
        waitMs: 0,
        claim: null,
        error: error.message,
      };
    }
    if (/800040|12400160/.test(String(error?.message))) {
      if (deferUntilReady) {
        return {
          startedNow,
          deferred: true,
          waitMs: Math.max(waitMs, LEGACY_FIRST_REWARD_MS),
          claim: null,
          error: error.message,
        };
      }
    } else {
      throw error;
    }
    await wait(settleMs + 3_000);
    claim = await client.sendWithPromise("legacy_claimhangup", {}, 8000);
  }

  return { startedNow, deferred: false, waitMs, claim };
}

async function runLegacyGift(client, token, task) {
  const { options, send } = createRunner(client, token, task);
  const recipientId = requiredNumberOption(options, "recipientId");
  const password = stringOption(options, "securityPassword");
  if (!recipientId) throw new Error("请填写功法残卷接收者 ID");
  if (!password) throw new Error("请填写游戏安全密码");
  const role = getRole(await send("role_getroleinfo", {}, 10000));
  const available = Math.min(
    9999,
    Number(role?.items?.[LEGACY_ITEM_ID]?.quantity || 0),
  );
  if (available <= 0) throw new Error("当前没有可赠送的功法残卷");
  const requested = numberOption(options, "giftQuantity", available, {
    min: 1,
    max: 9999,
  });
  const quantity = Math.min(available, requested);
  const target = await send(
    "rank_getroleinfo",
    {
      bottleType: 0,
      includeBottleTeam: false,
      isSearch: false,
      roleId: recipientId,
    },
    8000,
  );
  if (!target?.roleInfo?.roleId) throw new Error("接收者不存在");
  const verified = await send(
    "role_commitpassword",
    { password, passwordType: 1 },
    8000,
  );
  if (!verified?.role?.statistics?.["que:wh:tm"]) {
    throw new Error("游戏安全密码验证失败");
  }
  await send(
    "legacy_sendgift",
    { itemCnt: quantity, legacyUIds: [], targetId: recipientId },
    8000,
  );
  return {
    cmd: "batchLegacyGiftSendEnhanced",
    success: true,
    message: `已向 ${target.roleInfo.name || recipientId} 赠送功法残卷 ${quantity} 个`,
  };
}

export const NATIVE_TASK_GROUPS = [
  { key: "daily", label: "日常" },
  { key: "dungeon", label: "副本" },
  { key: "baoku", label: "宝库" },
  { key: "weirdTower", label: "怪异塔" },
  { key: "resource", label: "资源" },
  { key: "legacy", label: "功法" },
  { key: "monthly", label: "月度" },
];

export const NATIVE_TASK_CATALOG = {
  startBatch: {
    name: "日常任务",
    group: "daily",
    description: "按服务器任务列表执行补差、领奖并核对进度",
  },
  claimHangUpRewards: {
    name: "领取挂机",
    group: "daily",
    description: "领取挂机奖励，并补满服务器已空出的助力槽位",
  },
  batchAddHangUpTime: {
    name: "一键加钟",
    group: "daily",
    description: "只补满服务器已空出的挂机助力槽位",
  },
  resetBottles: { name: "重置罐子", group: "daily" },
  batchlingguanzi: { name: "一键领取罐子", group: "daily" },
  climbTower: {
    name: "一键爬塔",
    group: "dungeon",
  },
  climbWeirdTower: {
    name: "一键爬怪异塔",
    group: "weirdTower",
    options: [
      {
        key: "weirdTowerMaxClimb",
        label: "最多挑战次数",
        type: "number",
        default: 100,
        min: 1,
        max: 1000,
      },
    ],
  },
  batchStudy: { name: "一键答题", group: "daily" },
  batchOpenBox: {
    name: "批量开箱",
    group: "resource",
    options: [
      {
        key: "boxType",
        label: "宝箱类型",
        type: "select",
        default: 2001,
        options: [
          { label: "木质宝箱", value: 2001 },
          { label: "青铜宝箱", value: 2002 },
          { label: "黄金宝箱", value: 2003 },
          { label: "铂金宝箱", value: 2004 },
          { label: "钻石宝箱", value: 2005 },
        ],
      },
      {
        key: "boxCount",
        label: "开箱数量",
        type: "number",
        default: 100,
        min: 1,
        max: 5000,
      },
    ],
  },
  batchOpenBoxByPoints: {
    name: "按积分开箱",
    group: "resource",
    options: [
      {
        key: "targetBoxPoints",
        label: "目标宝箱积分",
        type: "number",
        default: 1000,
        min: 10,
        max: 10000,
      },
    ],
  },
  batchClaimBoxPointReward: {
    name: "领取宝箱积分",
    group: "resource",
  },
  batchFish: {
    name: "批量钓鱼",
    group: "resource",
    options: [
      {
        key: "fishType",
        label: "鱼竿类型",
        type: "select",
        default: 1,
        options: [
          { label: "普通鱼竿", value: 1 },
          { label: "黄金鱼竿", value: 2 },
        ],
      },
      {
        key: "fishCount",
        label: "钓鱼次数",
        type: "number",
        default: 100,
        min: 1,
        max: 5000,
      },
    ],
  },
  batchRecruit: {
    name: "批量招募",
    group: "resource",
    options: [
      {
        key: "recruitCount",
        label: "招募次数",
        type: "number",
        default: 100,
        min: 1,
        max: 5000,
      },
    ],
  },
  batchRedeemCodes: {
    name: "一键使用兑换码",
    group: "resource",
    options: [
      {
        key: "redeemCodes",
        label: "兑换码",
        type: "textarea",
        default: "",
        placeholder: "每行一个，或用逗号分隔",
      },
      {
        key: "platformType",
        label: "平台类型",
        type: "select",
        default: "h5",
        options: [
          { label: "H5", value: "h5" },
          { label: "微信小程序", value: "wx" },
        ],
      },
    ],
  },
  batchbaoku13: { name: "一键宝库前3层", group: "baoku" },
  batchbaoku45: { name: "一键宝库4,5层", group: "baoku" },
  batchmengjing: { name: "一键梦境", group: "dungeon" },
  batchclubsign: { name: "一键俱乐部签到", group: "daily" },
  batchCampChallenge: {
    name: "营地挑战",
    group: "daily",
  },
  batchCampChallengePet: {
    name: "营地挑战宠物",
    group: "daily",
  },
  batchCampClaimTasks: {
    name: "领取营地任务奖励",
    group: "daily",
  },
  batchApplyLegion: {
    name: "批量申请俱乐部",
    group: "daily",
    options: [
      {
        key: "legionId",
        label: "目标俱乐部 ID",
        type: "number",
        default: null,
        min: 1,
        required: true,
      },
    ],
  },
  batcharenafight: {
    name: "一键竞技场战斗3次",
    group: "daily",
  },
  batchArenaClearTickets: {
    name: "竞技场清票",
    group: "daily",
    description: "按当前咸神门票逐场执行，无论胜负继续，单次最多 100 次",
    options: [
      {
        key: "arenaTicketCount",
        label: "最多执行次数",
        type: "number",
        default: 100,
        min: 1,
        max: 100,
      },
    ],
  },
  batchTopUpFish: { name: "一键钓鱼补齐", group: "monthly" },
  batchTopUpArena: {
    name: "一键竞技场补齐",
    group: "monthly",
  },
  batchClaimFreeEnergy: {
    name: "一键领取怪异塔免费道具",
    group: "weirdTower",
  },
  skinChallenge: { name: "一键换皮闯关", group: "dungeon" },
  legion_storebuygoods: {
    name: "一键购买四圣碎片",
    group: "resource",
  },
  store_syncpurchaseconfig: {
    name: "一键配置黑市采购清单",
    group: "resource",
    options: [
      {
        key: "blackMarketPurchaseList",
        label: "黑市采购清单",
        type: "textarea",
        default: "2002:10, 2003:10, 2004:10, 1012:7",
        placeholder: "格式：物品ID:折扣，例如 2002:10, 1012:7",
      },
    ],
  },
  store_purchase: { name: "一键黑市采购", group: "resource" },
  collection_claimfreereward: {
    name: "免费领取珍宝阁",
    group: "daily",
  },
  activity_claimrolluppack: {
    name: "一键领取十殿礼包",
    group: "daily",
    description: "领取主页十殿礼包中的第一个免费礼包",
  },
  activity_buystoregoods: {
    name: "领取周常免费礼包",
    group: "daily",
    description:
      "自动识别招募周或宝箱周，领取限时商店的第一个免费礼包；其他周常轮换需补充协议",
  },
  batchLegacyClaim: {
    name: "批量领取功法残卷",
    group: "legacy",
  },
  batchLegacyGiftSendEnhanced: {
    name: "批量赠送功法残卷",
    group: "legacy",
    options: [
      {
        key: "recipientId",
        label: "接收者角色 ID",
        type: "number",
        default: null,
        min: 1,
        required: true,
      },
      {
        key: "securityPassword",
        label: "游戏安全密码",
        type: "password",
        default: "",
        required: true,
      },
      {
        key: "giftQuantity",
        label: "赠送数量（留空赠送全部）",
        type: "number",
        default: null,
        min: 1,
        max: 9999,
      },
    ],
  },
  batchUseItems: { name: "一键使用怪异塔道具", group: "weirdTower" },
  batchMergeItems: { name: "一键怪异塔合成", group: "weirdTower" },
  batchUseAndMergeItems: {
    name: "一键怪异塔领取+使用+合成",
    group: "weirdTower",
  },
  batchClaimPeachTasks: {
    name: "一键领取蟠桃园任务",
    group: "dungeon",
  },
  batchGenieSweep: { name: "一键扫荡灯神", group: "daily" },
  batchBuyDreamItems: {
    name: "一键购买梦境商品",
    group: "dungeon",
    options: [
      {
        key: "dreamPurchaseList",
        label: "梦境商品购买配置",
        type: "dream-items",
        default: [...DEFAULT_DREAM_PURCHASES],
      },
    ],
  },
  batchXuanwuBlessing: { name: "一键玄武赐福", group: "daily" },
  nightmareChallenge: {
    name: "自动十殿",
    group: "nightmare",
    crossAccount: true,
  },
  nightmareCharmPurchase: {
    name: "抢十殿符咒",
    group: "nightmare",
    description: "按当前定时任务独立选择要抢的层和每层目标数量",
  },
};

export async function runNativeBatchTask(key, client, context) {
  const { token, task } = context;
  switch (key) {
    case "startBatch":
      return runDailyTasks(client, context);
    case "claimHangUpRewards":
      return [await runHangUp(client, token, task, true)];
    case "batchAddHangUpTime":
      return [await runHangUp(client, token, task, false)];
    case "resetBottles":
      return runResetBottles(client, context);
    case "batchlingguanzi":
      await client.sendWithPromise("bottlehelper_claim", {}, 5000);
      return [{ cmd: key, success: true, message: "盐罐领取完成" }];
    case "climbTower":
      return [await runClimbTower(client, token, task)];
    case "climbWeirdTower":
      return [await runClimbWeirdTower(client, token, task)];
    case "batchStudy":
      return [await runStudy(client, token, task)];
    case "batchOpenBox":
      return [await runOpenBox(client, token, task)];
    case "batchOpenBoxByPoints":
      return [await runOpenBoxByPoints(client, token, task)];
    case "batchClaimBoxPointReward":
      return [await runClaimBoxPoints(client, token, task)];
    case "batchFish":
      return [await runFish(client, token, task)];
    case "batchRecruit":
      return [await runRecruit(client, token, task)];
    case "batchRedeemCodes":
      return [await runRedeemCodes(client, token, task)];
    case "batchbaoku13":
      return [await runDungeonFloor(client, token, task, false)];
    case "batchbaoku45":
      return [await runDungeonFloor(client, token, task, true)];
    case "batchmengjing":
      return [await runDream(client, token, task)];
    case "batchclubsign":
      try {
        await client.sendWithPromise("legion_signin", {}, 5000);
        return [{ cmd: key, success: true, message: "俱乐部签到完成" }];
      } catch (error) {
        if (String(error.message).includes("2300190")) {
          return [{ cmd: key, success: true, message: "今天已经签到" }];
        }
        throw error;
      }
    case "batchCampChallenge":
      return [await runCampChallenge(client, token, task)];
    case "batchCampChallengePet":
      return [await runCampChallenge(client, token, task, { pet: true })];
    case "batchCampClaimTasks":
      return [await runCampTaskClaims(client, token, task)];
    case "batchApplyLegion":
      return [await runApplyLegion(client, token, task)];
    case "batcharenafight":
      return runArenaFights(client, context);
    case "batchArenaClearTickets":
      return runArenaTicketClear(client, {
        token,
        targetCount: numberOption(task?.options, "arenaTicketCount", 100, {
          min: 1,
          max: 100,
        }),
        maxFights: 100,
      });
    case "batchTopUpFish":
      return [await runTopUpFish(client, token, task)];
    case "batchTopUpArena":
      return [await runTopUpArena(client, token, task)];
    case "batchClaimFreeEnergy":
      return [await runFreeEnergy(client, token, task)];
    case "skinChallenge":
      return [await runSkinChallenge(client, token, task)];
    case "legion_storebuygoods":
      return [await runBuyLegionGoods(client, token, task)];
    case "store_syncpurchaseconfig":
      return [await runSyncBlackMarket(client, token, task)];
    case "store_purchase":
      return [await runBlackMarketPurchase(client, token, task)];
    case "collection_claimfreereward":
      try {
        await client.sendWithPromise("collection_claimfreereward", {}, 5000);
        return [{ cmd: key, success: true, message: "珍宝阁奖励领取完成" }];
      } catch (error) {
        if (/12000116|1000020|700020/.test(String(error.message))) {
          return [{ cmd: key, success: true, message: "今日奖励已经领取" }];
        }
        throw error;
      }
    case "activity_claimrolluppack":
      try {
        await client.sendWithPromise(
          "activity_claimrolluppack",
          { id: TEN_DAY_FREE_GIFT_ID },
          5000,
        );
        return [{ cmd: key, success: true, message: "十殿免费礼包领取完成" }];
      } catch (error) {
        const errorText = String(error.message);
        if (/12000116|1000020|700020|3500020/.test(errorText)) {
          return [
            {
              cmd: key,
              success: true,
              status: "info",
              message: "十殿免费礼包今日已经领取",
            },
          ];
        }
        if (/200020/.test(errorText)) {
          return [
            {
              cmd: key,
              success: true,
              status: "warning",
              message: "十殿免费礼包可能已经领取（服务器返回 200020），未重试",
            },
          ];
        }
        throw error;
      }
    case "activity_buystoregoods": {
      const activityResponse = await client.sendWithPromise(
        "activity_get",
        {},
        8000,
      );
      const weeklyState = detectWeeklyStoreState(activityResponse);
      if (!weeklyState.supported) {
        return [
          {
            cmd: key,
            success: true,
            status: "info",
            message: "当前周常商店协议尚未配置，跳过免费礼包领取",
          },
        ];
      }
      if (!weeklyState.active) {
        return [
          {
            cmd: key,
            success: true,
            status: "info",
            message: "当前限时商店活动未开放，跳过免费礼包领取",
          },
        ];
      }
      if (weeklyState.complete) {
        return [
          {
            cmd: key,
            success: true,
            status: "info",
            message: `${weeklyState.label}限时商店本周已经领取`,
          },
        ];
      }
      try {
        await client.sendWithPromise(
          "activity_buystoregoods",
          weeklyState.goods,
          5000,
        );
        return [
          {
            cmd: key,
            success: true,
            message: `${weeklyState.label}限时商店奖励领取完成`,
          },
        ];
      } catch (error) {
        const errorText = String(error.message);
        if (/1100010/.test(errorText)) {
          return [
            {
              cmd: key,
              success: true,
              status: "warning",
              message: `${weeklyState?.label || "周常"}限时商店本周已经领取`,
            },
          ];
        }
        if (/12000116|1000020|700020|7900023/.test(errorText)) {
          return [
            {
              cmd: key,
              success: true,
              status: "warning",
              message: `${weeklyState?.label || "周常"}限时商店本周已经领取`,
            },
          ];
        }
        throw error;
      }
    }
    case "batchLegacyClaim": {
      const result = await claimLegacyHangUp(client, {
        deferUntilReady: true,
      });
      return [
        {
          cmd: key,
          success: true,
          status: result.deferred ? "info" : "success",
          deferred: result.deferred,
          message: result.rateLimited
            ? "领取过于频繁，奖励保留到下次定时执行"
            : result.deferred
              ? result.startedNow
                ? "功法残卷收集已自动开始，奖励成熟后将自动领取"
                : "功法残卷奖励尚未成熟，稍后自动领取"
              : result.startedNow
                ? "功法残卷已自动开始收集并领取完成"
                : "功法残卷领取完成",
        },
      ];
    }
    case "batchLegacyGiftSendEnhanced":
      return [await runLegacyGift(client, token, task)];
    case "batchUseItems":
      return [await runUseWeirdTowerItems(client, token, task)];
    case "batchMergeItems":
      return [await runMergeWeirdTowerItems(client, token, task)];
    case "batchUseAndMergeItems":
      return [await runUseAndMergeWeirdTowerItems(client, token, task)];
    case "batchClaimPeachTasks":
      return [await runPeachTasks(client, token, task)];
    case "batchGenieSweep":
      return [await runGenieSweep(client, token, task)];
    case "batchBuyDreamItems":
      return [await runBuyDreamItems(client, token, task)];
    case "batchXuanwuBlessing":
      return runXuanwuBlessing(client, context);
    case "nightmareCharmPurchase":
      return [
        await runCharmPurchaseForClient({
          client,
          token,
          charmSettings: charmSettingsForTask(task),
          waitUntil: task?.options?.charmPurchaseWaitUntil,
        }),
      ];
    case "nightmareChallenge":
      throw new Error("自动十殿必须使用跨账号编排器，不能按单账号执行");
    default:
      throw new Error(`未知原生批量任务: ${key}`);
  }
}

export function createNativeTaskDefinitions() {
  return Object.fromEntries(
    Object.entries(NATIVE_TASK_CATALOG).map(([key, definition]) => [
      key,
      {
        ...definition,
        group: definition.group,
        options: definition.options || [],
        run: (client, context) =>
          runNativeBatchTask(key, client, { ...context, task: context.task }),
      },
    ]),
  );
}
