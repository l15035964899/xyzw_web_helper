const DAY_MS = 24 * 60 * 60 * 1000;
const WAR_ORDER_SUFFIX = "1";
const SIGN_SUFFIX = "5";
const GOODS_SUFFIX = "41";
const MAX_REWARD_ROUNDS = 10;
const SIGN_MAX_DAY = 6;

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
  shanghaiDateBase,
};
