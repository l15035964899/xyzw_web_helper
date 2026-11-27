import { DailyTaskRunner } from "./dailyTaskRunner.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WAR_ORDER_SUFFIX = "1";
const SIGN_SUFFIX = "5";
const GOODS_SUFFIX = "41";
const MAX_REWARD_ROUNDS = 10;
const SIGN_MAX_DAY = 6;
const DAILY_SETTINGS_DEFAULTS = {
  arenaFormation: 1,
  bossFormation: 1,
  bossTimes: 2,
  claimBottle: true,
  payRecruit: true,
  openBox: true,
  arenaEnable: true,
  claimHangUp: true,
  claimEmail: true,
  blackMarketPurchase: true,
  freeGachaEnable: true,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shanghaiDateBase(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => ["year", "month", "day"].includes(type))
      .map(({ type, value }) => [type, value]),
  );
  return `${values.year.slice(-2)}${values.month}${values.day}`;
}

export function getShanghaiHour(date = new Date()) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;
  return Number(hour);
}

export function isArenaOpenAt(date = new Date()) {
  const hour = getShanghaiHour(date);
  return hour >= 6 && hour < 22;
}

function arenaClosedMessage(date = new Date()) {
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `竞技场每日开放时间为 06:00-22:00（Asia/Shanghai），当前 ${time} 不在开放时间，跳过竞技场清票`;
}

function isArenaConnectionError(error) {
  return /未连接|连接已关闭|websocket|socket|请求超时|timeout/i.test(
    String(error?.message || error),
  );
}

function formatReward(reward = []) {
  return reward
    .map((item) => {
      if (item.type === 2) return `金砖x${item.value}`;
      if (item.type === 3) return `道具${item.itemId}x${item.value}`;
      return `类型${item.type}x${item.value}`;
    })
    .join(", ");
}

function createRecorder() {
  const results = [];
  const send = async (
    client,
    cmd,
    params = {},
    { timeoutMs = 8000, tolerateError = false } = {},
  ) => {
    try {
      const data = await client.sendWithPromise(cmd, params, timeoutMs);
      results.push({ cmd, success: true, data });
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ cmd, success: false, error: message });
      if (!tolerateError) throw error;
      return null;
    }
  };
  return { results, send };
}

function normalizeObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function taskSettings(token, options = {}) {
  return {
    ...DAILY_SETTINGS_DEFAULTS,
    ...normalizeObject(options),
    ...normalizeObject(token?.daily_settings),
  };
}

function createTokenStore(client, token) {
  const tokenId = token.id;
  const tokenStore = {
    gameTokens: [{ id: tokenId, name: token.name }],
    wsConnections: { [tokenId]: { client } },
    getWebSocketStatus: () =>
      client.connected && client.ws ? "connected" : "disconnected",
    sendGetRoleInfo: (_id, params = {}, _retryCount) =>
      client.sendWithPromise("role_getroleinfo", params, 15000),
    sendMessageWithPromise: (_id, cmd, params = {}, timeoutMs = 8000) =>
      client.sendWithPromise(cmd, params, timeoutMs),
  };
  return tokenStore;
}

function logResult(results, status, message) {
  results.push({
    cmd: "dailyRunner",
    success: status !== "error",
    message,
    status,
  });
}

/**
 * Run the browser's server-driven daily task runner against a Node GameClient.
 * Account-specific settings can be stored in tokens.daily_settings.
 */
export async function runDailyTasks(
  client,
  { token, delayMs = 500, task = null } = {},
) {
  const results = [];
  const tokenStore = createTokenStore(client, token);
  const runner = new DailyTaskRunner(tokenStore, {
    commandDelay: delayMs,
    taskDelay: delayMs,
  });
  try {
    const result = await runner.run(
      token.id,
      {
        shouldStop: () => !client.connected,
        onLog: ({ message, type = "info" }) =>
          logResult(results, type, message),
      },
      taskSettings(token, task?.options),
    );
    results.push(dailyTaskResultSummary(result));
  } catch (error) {
    results.push({
      cmd: "dailyBundle",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return results;
}

export function dailyTaskResultSummary(result = {}) {
  const incomplete = Math.max(0, Number(result.incomplete) || 0);
  const failed = Math.max(0, Number(result.failed) || 0);
  const deferred = Math.max(0, Number(result.deferred) || 0);
  const complete = incomplete === 0 && failed === 0 && deferred === 0;
  return {
    cmd: "dailyBundle",
    success: complete,
    status: complete ? "success" : failed > 0 ? "error" : "warning",
    deferred: incomplete > 0 || deferred > 0,
    message: complete
      ? "服务器每日任务补差完成；待继续 0 项，失败 0 项"
      : `服务器每日任务尚未完成；待继续 ${incomplete} 项，延期 ${deferred} 项，失败 ${failed} 项`,
  };
}

function pickArenaTargetId(targets) {
  const candidate =
    targets?.[0] ||
    targets?.rankList?.[0] ||
    targets?.roleList?.[0] ||
    targets?.targets?.[0] ||
    targets?.targetList?.[0] ||
    targets?.list?.[0];
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

/**
 * Perform the configured daily arena fights and restore the original formation.
 */
export async function runArenaFights(client, { token, delayMs = 500 } = {}) {
  const { results, send } = createRecorder();
  const settings = taskSettings(token);
  const role = await send(
    client,
    "role_getroleinfo",
    {},
    {
      timeoutMs: 15000,
    },
  );
  const roleData = role?.role || role;
  const tickets = Number(roleData?.items?.[1007]?.quantity || 0);
  const fights = Math.min(3, Math.max(0, tickets));
  if (fights === 0) {
    results.push({
      cmd: "arenaFight",
      success: true,
      message: "咸神门票为 0，跳过竞技场战斗",
    });
    return results;
  }

  const teamInfo = await send(
    client,
    "presetteam_getinfo",
    {},
    {
      timeoutMs: 5000,
    },
  );
  const originalFormation = Number(teamInfo?.presetTeamInfo?.useTeamId || 0);
  const targetFormation = Number(settings.arenaFormation || 1);
  const switched =
    originalFormation > 0 && originalFormation !== targetFormation;
  if (switched) {
    await send(
      client,
      "presetteam_saveteam",
      { teamId: targetFormation },
      { timeoutMs: 5000 },
    );
  }

  try {
    for (let index = 0; index < fights; index += 1) {
      await send(client, "arena_startarea", {});
      const targets = await send(client, "arena_getareatarget", {});
      const targetId = pickArenaTargetId(targets);
      if (!targetId) {
        results.push({
          cmd: "arenaFight",
          success: false,
          error: "未找到可用的竞技场目标",
        });
        break;
      }
      await send(
        client,
        "fight_startareaarena",
        { targetId },
        { timeoutMs: 15000 },
      );
      results.push({
        cmd: "arenaFight",
        success: true,
        message: `竞技场战斗 ${index + 1}/${fights} 完成，目标 ${targetId}`,
      });
      await sleep(delayMs);
    }
  } finally {
    if (switched && originalFormation > 0) {
      await send(
        client,
        "presetteam_saveteam",
        { teamId: originalFormation },
        { timeoutMs: 5000, tolerateError: true },
      );
    }
  }
  return results;
}

/**
 * Spend arena tickets up to an explicit per-run limit. Every battle outcome,
 * including a rejected fight command, advances the attempt counter so the
 * task cannot get stuck retrying the same result.
 */
export async function runArenaTicketClear(
  client,
  {
    token,
    targetCount = 100,
    delayMs = 500,
    maxFights = 100,
    now = () => new Date(),
  } = {},
) {
  const currentTime = now();
  if (!isArenaOpenAt(currentTime)) {
    return [
      {
        cmd: "batchArenaClearTickets",
        success: true,
        status: "info",
        message: arenaClosedMessage(currentTime),
      },
    ];
  }
  const hardLimit = Math.max(
    1,
    Math.min(100, Math.trunc(Number(maxFights) || 100)),
  );
  const requested = Math.max(
    1,
    Math.min(hardLimit, Math.trunc(Number(targetCount) || hardLimit)),
  );
  const results = [];
  const roleResponse = await client.sendWithPromise(
    "role_getroleinfo",
    {},
    15000,
  );
  const roleData = roleResponse?.role || roleResponse;
  const initialTickets = Math.max(
    0,
    Number(roleData?.items?.[1007]?.quantity || 0),
  );
  const plannedFights = Math.min(requested, initialTickets);
  if (plannedFights <= 0) {
    return [
      {
        cmd: "arenaClearTickets",
        success: true,
        status: "info",
        message: `咸神门票为 0，跳过竞技场清票（本次上限 ${requested} 次）`,
      },
    ];
  }

  const teamInfo = await client.sendWithPromise("presetteam_getinfo", {}, 5000);
  const settings = taskSettings(token);
  const originalFormation = Number(teamInfo?.presetTeamInfo?.useTeamId || 0);
  const targetFormation = Math.max(
    1,
    Math.min(6, Math.trunc(Number(settings.arenaFormation) || 1)),
  );
  const switched =
    originalFormation > 0 && originalFormation !== targetFormation;
  let attempted = 0;
  let failed = 0;
  let closedEarly = false;

  try {
    if (switched) {
      await client.sendWithPromise(
        "presetteam_saveteam",
        { teamId: targetFormation },
        5000,
      );
    }
    try {
      await client.sendWithPromise("arena_startarea", {}, 6000);
    } catch (error) {
      if (isArenaConnectionError(error)) throw error;
      results.push({
        cmd: "arena_startarea",
        success: true,
        status: "warning",
        message: `进入竞技场返回异常，继续尝试战斗：${error.message}`,
      });
    }

    for (let index = 0; index < plannedFights; index += 1) {
      const loopTime = now();
      if (!isArenaOpenAt(loopTime)) {
        closedEarly = true;
        results.push({
          cmd: "batchArenaClearTickets",
          success: true,
          status: "warning",
          message: arenaClosedMessage(loopTime),
        });
        break;
      }
      let targetId = null;
      try {
        const targets = await client.sendWithPromise(
          "arena_getareatarget",
          {},
          8000,
        );
        targetId = pickArenaTargetId(targets);
      } catch (error) {
        if (isArenaConnectionError(error)) throw error;
        failed += 1;
        results.push({
          cmd: "arenaClearTickets",
          success: true,
          status: "warning",
          message: `竞技场清票 ${index + 1}/${plannedFights} 读取对手失败，继续下一场：${error.message}`,
        });
      }
      if (!targetId) {
        if (results.at(-1)?.cmd !== "arenaClearTickets") {
          failed += 1;
          results.push({
            cmd: "arenaClearTickets",
            success: true,
            status: "warning",
            message: `竞技场清票 ${index + 1}/${plannedFights} 未找到可用对手，继续下一场`,
          });
        }
        await sleep(delayMs);
        continue;
      }

      attempted += 1;
      try {
        await client.sendWithPromise(
          "fight_startareaarena",
          { targetId },
          15000,
        );
        results.push({
          cmd: "arenaClearTickets",
          success: true,
          status: "success",
          message: `竞技场清票 ${index + 1}/${plannedFights} 完成，继续使用剩余门票`,
        });
      } catch (error) {
        failed += 1;
        results.push({
          cmd: "arenaClearTickets",
          success: true,
          status: "warning",
          message: `竞技场清票 ${index + 1}/${plannedFights} 战斗失败，继续下一场：${error.message}`,
        });
        if (isArenaConnectionError(error)) throw error;
      }
      await sleep(delayMs);
    }
  } finally {
    if (switched && originalFormation > 0) {
      try {
        await client.sendWithPromise(
          "presetteam_saveteam",
          { teamId: originalFormation },
          5000,
        );
        results.push({
          cmd: "arenaRestoreFormation",
          success: true,
          message: `已恢复原竞技场阵容 ${originalFormation}`,
        });
      } catch (error) {
        results.push({
          cmd: "arenaRestoreFormation",
          success: true,
          status: "warning",
          message: `恢复原竞技场阵容失败：${error.message}`,
        });
      }
    }
  }

  let remainingTickets = Math.max(0, initialTickets - attempted);
  try {
    const finalRole = await client.sendWithPromise(
      "role_getroleinfo",
      {},
      10000,
    );
    const finalRoleData = finalRole?.role || finalRole;
    remainingTickets = Math.max(
      0,
      Number(finalRoleData?.items?.[1007]?.quantity || 0),
    );
  } catch {
    // Keep the local estimate when the final account read is unavailable.
  }
  results.push({
    cmd: "arenaClearTickets",
    success: true,
    status: failed > 0 || closedEarly ? "warning" : "success",
    message: `竞技场清票结束：目标 ${requested} 次，计划 ${plannedFights} 次，实际发起 ${attempted} 次，异常 ${failed} 次，剩余门票 ${remainingTickets}${closedEarly ? "；到达 22:00 关闭时间后提前停止" : ""}`,
  });
  return results;
}

/**
 * Reset and restart the salt bottle timer for one account.
 * The game rejects a restart if the stop acknowledgement is not processed first.
 */
export async function runResetBottles(client, { delayMs = 500 } = {}) {
  const { results, send } = createRecorder();
  await send(client, "bottlehelper_stop", {}, { timeoutMs: 5000 });
  await sleep(delayMs);
  await send(client, "bottlehelper_start", {}, { timeoutMs: 5000 });
  return results;
}

async function resolveWarOrder(client, send, now) {
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const date = new Date(now.getTime() - dayOffset * DAY_MS);
    const actId = Number(shanghaiDateBase(date) + WAR_ORDER_SUFFIX);
    const response = await send(
      client,
      "activity_warorderget",
      { actId },
      { tolerateError: true },
    );
    const info = response?.activity?.warOrderActivityInfo?.[actId] || null;
    if (info) return { actId, info };
  }
  return null;
}

async function claimCompletedTasks(client, send, actId, info) {
  const claimedMap = { ...(info?.taskClaimed || {}) };
  let claimed = 0;
  let skipped = 0;

  for (const [missionId, progress] of Object.entries(info?.complete || {})) {
    if (claimedMap[missionId] === true || !(progress > 0)) continue;
    const response = await send(
      client,
      "activity_warordertaskclaim",
      { actId, missionId: Number(missionId) },
      { tolerateError: true },
    );
    if (!response) {
      skipped += 1;
      continue;
    }
    Object.assign(
      claimedMap,
      response?.activity?.warOrderActivityInfo?.[actId]?.taskClaimed || {},
    );
    if (response?.reward?.length) {
      claimed += 1;
      claimedMap[missionId] = true;
    } else {
      skipped += 1;
    }
  }

  return { claimed, skipped };
}

async function claimPassRewards(client, send, actId) {
  let rounds = 0;
  for (let round = 0; round < MAX_REWARD_ROUNDS; round += 1) {
    const response = await send(
      client,
      "activity_warorderrewardclaim",
      { actId },
      { tolerateError: true },
    );
    if (!response?.reward?.length) break;
    rounds += 1;
  }
  return rounds;
}

async function runXuanwuForToken(client, send, delayMs, now) {
  const resolved = await resolveWarOrder(client, send, now);
  if (!resolved) {
    throw new Error("未找到玄武赐福活动，请确认活动是否开启");
  }

  const { actId, info } = resolved;
  const activityBase = String(actId).slice(0, 6);
  const signActivityId = Number(activityBase + SIGN_SUFFIX);
  const goodsId = Number(activityBase + GOODS_SUFFIX);

  const first = await claimCompletedTasks(client, send, actId, info);
  let passRewards = await claimPassRewards(client, send, actId);
  await sleep(delayMs);

  const freeGoods = await send(
    client,
    "activity_commonbuygoods",
    { goodsId },
    { tolerateError: true },
  );
  await sleep(delayMs);

  await send(
    client,
    "activity_getlotteryinfo",
    {},
    {
      tolerateError: true,
    },
  );
  const lottery = await send(
    client,
    "activity_lottery",
    { times: 1 },
    { tolerateError: true },
  );
  await sleep(delayMs);

  let signDays = 0;
  for (let patchDay = 0; patchDay <= SIGN_MAX_DAY; patchDay += 1) {
    const response = await send(
      client,
      "activity_claimsignreward",
      { activityId: signActivityId, patchDay },
      { tolerateError: true },
    );
    if (response?.reward?.length) signDays += 1;
  }

  let secondClaimed = 0;
  if (lottery || signDays > 0) {
    const latest = await send(
      client,
      "activity_warorderget",
      { actId },
      { tolerateError: true },
    );
    const latestInfo = latest?.activity?.warOrderActivityInfo?.[actId];
    if (latestInfo) {
      const second = await claimCompletedTasks(client, send, actId, latestInfo);
      secondClaimed = second.claimed;
      if (secondClaimed > 0) {
        passRewards += await claimPassRewards(client, send, actId);
      }
    }
  }

  const lotteryReward = lottery?.reward?.length
    ? formatReward(lottery.reward)
    : "无奖励";
  const freeGoodsText = freeGoods ? "成功" : "已购买或不可购买";
  return {
    cmd: "batchXuanwuBlessing",
    success: true,
    message:
      `任务领取${first.claimed + secondClaimed}个，` +
      `通行证奖励${passRewards}次，点卯${signDays}天，` +
      `抽奖${lotteryReward}，免费珍宝${freeGoodsText}`,
  };
}

/**
 * Run the Xuanwu blessing activity sequence for one account.
 * Every expected "already claimed" error is recorded without aborting later steps.
 */
export async function runXuanwuBlessing(
  client,
  { delayMs = 300, now = new Date() } = {},
) {
  const recorder = createRecorder();
  const summary = await runXuanwuForToken(client, recorder.send, delayMs, now);
  return [...recorder.results, summary];
}

export const __test = {
  createTokenStore,
  shanghaiDateBase,
};
