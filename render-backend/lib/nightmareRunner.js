import {
  DEFAULT_CHARM_PRIORITY,
  DEFAULT_CHARM_TARGETS,
  getNightmareStageOrder,
  NIGHTMARE_RESTORE_LIMITS,
  normalizeNightmareCharmSettings,
} from "./nightmareSettings.js";
import { expectedRoleIdFromToken } from "./roleIdentity.js";

const NIGHTMARE_TEAM_CFG_ID = 1;
const FAST_MIN_WAIT_MS = 5_000;
const NORMAL_ANIMATION_GRACE_MS = 3_000;
const CHARM_BUY_COOLDOWN_MS = 2_000;
const CHARM_COSTS = Object.freeze({
  1: 10,
  2: 10,
  3: 10,
  4: 20,
  5: 30,
  6: 40,
});

export const NIGHTMARE_COMMANDS = Object.freeze({
  getRoleInfo: "nightmare_getroleinfo",
  getRoomInfo: "nightmare_getroominfo",
  setFighter: "nightmare_setfighter",
  fight: "nightmare_fight",
  leaderComplete: "nightmare_leadercomplete",
  restore: "nightmare_restore",
  dismissRoom: "nightmare_dismiss",
  getCharm: "nightmare_getcharm",
  buyCharm: "nightmare_buycharm",
});

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function tokenRoleId(token) {
  return numberValue(expectedRoleIdFromToken(token), 0);
}

function tokenLabel(token) {
  return String(token?.name || token?.id || "账号");
}

export function getArenaFormation(token) {
  const parsed = Math.trunc(
    Number(
      token?.daily_settings?.arenaFormation ??
        token?.dailySettings?.arenaFormation,
    ),
  );
  return parsed >= 1 && parsed <= 6 ? parsed : 1;
}

export function getArenaFormationMap(tokens) {
  return Object.fromEntries(
    (tokens || []).map((token) => [String(token.id), getArenaFormation(token)]),
  );
}

function isObject(value) {
  return Boolean(value) && typeof value === "object";
}

export function deepMerge(target, patch) {
  if (!isObject(patch)) return target;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (isObject(value) && !Array.isArray(value)) {
      const base = isObject(target[key]) ? target[key] : {};
      target[key] = deepMerge(base, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

export function normalizeNumberMap(value) {
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [
        String(key),
        numberValue(entry),
      ]),
    );
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value.map((entry, index) => [
        String(entry?.id ?? entry?.layer ?? index + 1),
        numberValue(entry?.count ?? entry?.num ?? entry?.value),
      ]),
    );
  }
  if (!isObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      String(key),
      numberValue(entry?.count ?? entry?.num ?? entry?.value ?? entry),
    ]),
  );
}

export function extractRoomInfo(response) {
  return (
    response?.roomInfo || response?.nightMareData?.roomInfo || response || null
  );
}

export function extractNightmareRoleInfo(response) {
  return response?.nightMareData || response?.nightMare || response || null;
}

export function getCharmCounts(roleInfo) {
  const nightmare = extractNightmareRoleInfo(roleInfo) || {};
  return normalizeNumberMap(nightmare.charmData);
}

export function areCharmCountsCurrent(roleInfo, now = new Date()) {
  const nightmare = extractNightmareRoleInfo(roleInfo) || {};
  const resetAt = numberValue(nightmare.charmResetTime);
  if (!resetAt) return true;
  return (
    startOfShanghaiWeek(new Date(resetAt * 1000)) === startOfShanghaiWeek(now)
  );
}

export function getCharmInventoryNeeds(
  counts,
  targets = DEFAULT_CHARM_TARGETS,
  priority = DEFAULT_CHARM_PRIORITY,
) {
  const normalizedCounts = normalizeNumberMap(counts);
  const normalizedTargets = normalizeNumberMap(targets);
  const order = [...new Set([...priority, 1, 2, 3, 4, 5, 6])];
  return order
    .map(Number)
    .filter((layer) => layer >= 1 && layer <= 6)
    .map((layer) => ({
      layer,
      current: numberValue(normalizedCounts[layer]),
      target: numberValue(
        normalizedTargets[layer],
        DEFAULT_CHARM_TARGETS[layer] || 1,
      ),
    }))
    .filter((entry) => entry.current < entry.target);
}

function startOfShanghaiWeek(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((entry) => entry.type !== "literal")
      .map((entry) => [entry.type, entry.value]),
  );
  const shanghaiMidnightAsUtc = Date.parse(
    `${parts.year}-${parts.month}-${parts.day}T00:00:00+08:00`,
  );
  const weekday = new Date(
    `${parts.year}-${parts.month}-${parts.day}T12:00:00Z`,
  ).getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  return shanghaiMidnightAsUtc - daysFromMonday * 24 * 60 * 60 * 1000;
}

function isSundayInShanghai(date = new Date()) {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      weekday: "short",
    }).format(date) === "Sun"
  );
}

export function getNextMondayMidnight(date = new Date()) {
  const weekStart = startOfShanghaiWeek(date);
  return new Date(weekStart + 7 * 24 * 60 * 60 * 1000);
}

export function getNextShanghaiMidnight(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((entry) => entry.type !== "literal")
      .map((entry) => [entry.type, entry.value]),
  );
  const todayMidnight = Date.parse(
    `${parts.year}-${parts.month}-${parts.day}T00:00:00+08:00`,
  );
  return new Date(todayMidnight + 24 * 60 * 60 * 1000);
}

export function shouldPauseForCrossWeek(team, layer, now = new Date()) {
  if (!team?.crossWeek || Number(layer) !== 8) return false;
  if (!team.forceCrossWeek && !isSundayInShanghai(now)) return false;
  const untilMidnight = getNextShanghaiMidnight(now).getTime() - now.getTime();
  if (team.forceCrossWeek) return untilMidnight <= 4 * 60 * 60 * 1000;
  return now.getTime() < getNextShanghaiMidnight(now).getTime();
}

export function isRoomLayerCleared(roomInfo, layer) {
  const targetLayer = Number(layer);
  const currentLayer = numberValue(
    roomInfo?.curMonsterCfgId ?? roomInfo?.currentLayer,
    0,
  );
  if (currentLayer > targetLayer) return true;
  const monsterInfo = roomInfo?.monsterTeamInfo?.[targetLayer];
  if (!monsterInfo) return false;
  const attacked = numberValue(monsterInfo.totalAttacked);
  const monsterData = monsterInfo.curMonsterData;
  if (!monsterData || typeof monsterData !== "object") return false;
  const units = Object.values(monsterData);
  if (!attacked && !units.some((unit) => numberValue(unit?.curHp) > 0)) {
    return false;
  }
  return (
    units.length > 0 && units.every((unit) => numberValue(unit?.curHp) <= 0)
  );
}

export function getRoomLayerHp(roomInfo, layer) {
  const monsterData =
    roomInfo?.monsterTeamInfo?.[Number(layer)]?.curMonsterData;
  if (!monsterData || typeof monsterData !== "object") return null;
  const values = Object.values(monsterData).map((unit) =>
    numberValue(unit?.curHp),
  );
  if (values.length === 0) return null;
  return values.reduce((sum, hp) => sum + hp, 0);
}

export function getMemberHealth(roomInfo, roleId) {
  const member = roomInfo?.playerTeamInfo?.[roleId] || {};
  const current =
    member.curHeroData || member.curHeroes || member.heroData || {};
  const maxTeam =
    roomInfo?.fightRoleBase?.find(
      (entry) => Number(entry?.roleId) === Number(roleId),
    )?.battleData?.team || {};
  const maxByHero = Object.fromEntries(
    Object.values(maxTeam)
      .filter((hero) => hero?.id !== undefined)
      .map((hero) => [String(hero.id), numberValue(hero.hp)]),
  );
  const heroes = Object.entries(current).map(([heroId, hero]) => {
    const maxHp = maxByHero[String(hero?.id ?? heroId)] || 0;
    const hp = numberValue(hero?.curHp ?? hero?.hp ?? hero);
    return { heroId: String(hero?.id ?? heroId), hp, maxHp };
  });
  return {
    heroes,
    total: heroes.length,
    alive: heroes.filter((hero) => hero.hp > 0).length,
    damaged: heroes.some(
      (hero) => hero.hp <= 0 || (hero.maxHp > 0 && hero.hp < hero.maxHp),
    ),
    fullyDead: heroes.length > 0 && heroes.every((hero) => hero.hp <= 0),
  };
}

export function wasMemberUsedOnLayer(roomInfo, layer, roleId) {
  const member =
    roomInfo?.monsterTeamInfo?.[Number(layer)]?.fightSnapData?.[
      String(roleId)
    ] || {};
  return numberValue(member.attackedNum) > 0;
}

function parseTeamList(response) {
  const map = response?.roleMTData?.gDMTData;
  if (!isObject(map)) return [];
  return Object.values(map)
    .map((entry) => ({
      teamId: String(entry?.teamId ?? ""),
      teamCfgId: numberValue(entry?.teamCfgId),
    }))
    .filter((entry) => entry.teamId);
}

function findDeepKey(value, key) {
  if (!isObject(value)) return "";
  if (value[key] !== undefined && value[key] !== "") {
    return String(value[key]);
  }
  for (const child of Object.values(value)) {
    if (!isObject(child)) continue;
    const found = findDeepKey(child, key);
    if (found) return found;
  }
  return "";
}

function pickTeamId(response) {
  return (
    String(response?.teamInfo?.teamId || "") || findDeepKey(response, "teamId")
  );
}

function noResponse(error) {
  return /超时|timeout/i.test(String(error?.message || error));
}

function isConnectionError(error) {
  return /未连接|连接已关闭|连接关闭|请求超时|timeout|websocket|socket/i.test(
    String(error?.message || error),
  );
}

export class NightmareRunner {
  constructor({
    clients,
    tokens,
    log = () => {},
    sleep = defaultSleep,
    now = () => new Date(),
    arenaFormations = {},
  } = {}) {
    this.clients = clients instanceof Map ? clients : new Map();
    this.tokens = tokens instanceof Map ? tokens : new Map();
    this.log = log;
    this.sleep = sleep;
    this.now = now;
    this.room = {};
    this.latestFight = null;
    this.boundListeners = [];
    this.roleIds = new Map();
    this.originalFormations = new Map();
    this.softErrors = [];
    this.arenaFormations =
      arenaFormations instanceof Map
        ? new Map(arenaFormations)
        : new Map(
            isObject(arenaFormations) ? Object.entries(arenaFormations) : [],
          );
    this.activeTokenIds = [];
    this.teamId = "";
    this.teamCleanupConfirmed = false;
    this.roomId = "";
    this.leaderTokenId = "";
  }

  token(tokenId) {
    return this.tokens.get(String(tokenId)) || null;
  }

  client(tokenId) {
    return this.clients.get(String(tokenId)) || null;
  }

  async reconnectLeader(tokenId = this.leaderTokenId) {
    const id = String(tokenId || "");
    const client = this.client(id);
    if (!client) throw new Error(`${tokenLabel(this.token(id))} 连接不存在`);
    let lastError = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        if (client.connected) client.disconnect();
        await this.sleep(1_000);
        await client.connect(15_000);
        const response = await client.sendWithPromise(
          "role_getroleinfo",
          {},
          10_000,
        );
        const actualRoleId = numberValue(
          response?.role?.roleId ?? response?.roleId,
        );
        const expectedRoleId = this.roleId(id);
        if (
          actualRoleId > 0 &&
          expectedRoleId > 0 &&
          actualRoleId !== expectedRoleId
        ) {
          throw new Error(
            `重连角色不一致：期望 ${expectedRoleId}，实际 ${actualRoleId}`,
          );
        }
        this.log(`${tokenLabel(this.token(id))}: 队长连接已恢复`, "success");
        return client;
      } catch (error) {
        lastError = error;
        if (attempt < 5) {
          this.log(
            `${tokenLabel(this.token(id))}: 队长连接恢复失败，3 秒后重试（${attempt}/5）：${error.message}`,
            "warning",
          );
          await this.sleep(3_000);
        }
      }
    }
    throw new Error(
      `${tokenLabel(this.token(id))}: 队长连接无法恢复${
        lastError ? `：${lastError.message}` : ""
      }`,
    );
  }

  async ensureLeaderReady(tokenId = this.leaderTokenId) {
    const client = this.client(tokenId);
    if (!client)
      throw new Error(`${tokenLabel(this.token(tokenId))} 连接不存在`);
    if (client.connected !== false) return client;
    return this.reconnectLeader(tokenId);
  }

  roleId(tokenId) {
    const known = this.roleIds.get(String(tokenId));
    if (known) return known;
    return tokenRoleId(this.token(tokenId));
  }

  formationState() {
    return Object.fromEntries(this.originalFormations.entries());
  }

  recordSoftError(context, error) {
    const message = `${context}：${error?.message || error}`;
    this.softErrors.push(message);
    this.log(`记录非致命错误：${message}`, "warning");
  }

  logSoftErrorSummary() {
    if (this.softErrors.length === 0) return;
    this.log(
      `本次十殿共记录 ${this.softErrors.length} 个非致命错误：${[
        ...new Set(this.softErrors),
      ].join("；")}`,
      "warning",
    );
  }

  attachRoomListeners() {
    this.dispose();
    for (const client of this.clients.values()) {
      if (typeof client?.on !== "function") continue;
      this.boundListeners.push(
        client.on("nightmare_roominfo_notify", (data) => {
          const patch = extractRoomInfo(data);
          if (patch) deepMerge(this.room, patch);
        }),
      );
      this.boundListeners.push(
        client.on("nightmare_fightnotify", (data) => {
          this.latestFight = data || null;
        }),
      );
    }
  }

  dispose() {
    for (const off of this.boundListeners.splice(0)) {
      try {
        off();
      } catch {
        // Best effort.
      }
    }
  }

  async getRoleInfo(tokenId) {
    const client = this.client(tokenId);
    if (!client) throw new Error(`${tokenLabel(this.token(tokenId))} 未连接`);
    const roleId = this.roleId(tokenId);
    return client.sendWithPromise(
      NIGHTMARE_COMMANDS.getRoleInfo,
      { roleId },
      10_000,
    );
  }

  async readRoom(tokenId) {
    const client = this.client(tokenId);
    if (!client || !this.roomId) return null;
    const response = await client.sendWithPromise(
      NIGHTMARE_COMMANDS.getRoomInfo,
      { roomId: this.roomId },
      10_000,
    );
    const info = extractRoomInfo(response);
    if (info) {
      for (const key of Object.keys(this.room)) delete this.room[key];
      deepMerge(this.room, info);
    }
    return info;
  }

  async findExistingRoom(team) {
    const leaderId = String(team.leaderTokenId);
    const leaderClient = this.client(leaderId);
    if (!leaderClient) return null;
    try {
      const response = await leaderClient.sendWithPromise(
        NIGHTMARE_COMMANDS.getRoleInfo,
        { roleId: this.roleId(leaderId) },
        10_000,
      );
      const info = extractNightmareRoleInfo(response);
      const roomId = info?.roomId ? String(info.roomId) : "";
      if (!roomId) return null;
      this.roomId = roomId;
      this.teamId =
        String(info.matchTeamId || info.teamId || "") || this.teamId;
      if (!this.teamId) {
        const current = await this.currentNightmareTeam(leaderId);
        this.teamId = String(current?.teamId || "");
      }
      this.teamCleanupConfirmed = false;
      this.activeTokenIds = team.members
        .map((entry) => String(entry.tokenId))
        .filter((tokenId) => Boolean(this.client(tokenId)));
      const roomInfo = await this.readRoom(leaderId);
      this.log(`检测到现有挑战房间 ${roomId}，由队长连接直接接管`, "success");
      return roomInfo;
    } catch {
      return null;
    }
  }

  async fetchMyTeams(tokenId) {
    const response = await this.client(tokenId).sendWithPromise(
      "matchteam_getroleteaminfo",
      { roleID: this.roleId(tokenId) },
      8_000,
    );
    return parseTeamList(response);
  }

  async currentNightmareTeam(tokenId) {
    const teams = await this.fetchMyTeams(tokenId);
    return (
      teams.find(
        (entry) => entry.teamCfgId === NIGHTMARE_TEAM_CFG_ID && entry.teamId,
      ) || null
    );
  }

  async syncStandaloneBattleTeam(tokenId) {
    const client = this.client(tokenId);
    const roleId = this.roleId(tokenId);
    if (!client || !roleId) return false;
    const target = await client.sendWithPromise(
      "role_gettargetteam",
      { targetId: roleId, teamType: 3, cCMonsterId: 0 },
      8_000,
    );
    const teamInfo = target?.teamInfo || {};
    const battleTeam = {};
    for (const [position, hero] of Object.entries(teamInfo.team || {})) {
      const heroId = hero?.id ?? hero?.heroId;
      if (heroId) battleTeam[position] = Number(heroId);
    }
    if (Object.keys(battleTeam).length === 0) return false;
    const lordWeaponId = numberValue(
      teamInfo.weaponId ?? teamInfo.lordWeaponId,
    );
    const petUId = teamInfo.petUId || findDeepKey(target, "petUId") || "";
    await client
      .sendWithPromise(
        "hero_calcpowerbyteam",
        { battleTeam, lordWeaponId, petUId },
        8_000,
      )
      .catch(() => {});
    client.send("team_setteam", {
      teamType: 3,
      battleTeam,
      lordWeaponId,
      petUId,
      cCMonsterId: 0,
    });
    this.log(
      `${tokenLabel(this.token(tokenId))}: 已同步十殿出战位 ${Object.entries(
        battleTeam,
      )
        .map(([position, heroId]) => `${position}:${heroId}`)
        .join("、")}`,
      "info",
    );
    await this.sleep(300);
    return true;
  }

  async switchFormation(tokenId, formation) {
    const client = this.client(tokenId);
    if (!client) return null;
    const info = await client.sendWithPromise("presetteam_getinfo", {}, 5_000);
    const original = numberValue(info?.presetTeamInfo?.useTeamId);
    const target = Math.min(6, Math.max(1, numberValue(formation, 1)));
    if (original === target) {
      this.log(
        `${tokenLabel(this.token(tokenId))}: 预设阵容已是 ${target}，无需切换`,
        "info",
      );
      return { original, target };
    }
    if (original > 0) {
      this.log(
        `${tokenLabel(this.token(tokenId))}: 切换预设阵容 ${original} → ${target}`,
        "info",
      );
    } else {
      this.log(
        `${tokenLabel(this.token(tokenId))}: 未读取到原阵容，正在设置目标阵容 ${target}`,
        "warning",
      );
    }
    await client.sendWithPromise(
      "presetteam_saveteam",
      { teamId: target },
      5_000,
    );
    await this.sleep(300);
    const after = await client.sendWithPromise("presetteam_getinfo", {}, 5_000);
    const verified = numberValue(after?.presetTeamInfo?.useTeamId);
    if (verified !== target) {
      throw new Error(
        `${tokenLabel(this.token(tokenId))}: 切换后预设阵容仍为 ${verified || "未知"}，目标为 ${target}`,
      );
    }
    return { original, target };
  }

  async restoreFormations() {
    const targets =
      this.arenaFormations.size > 0
        ? this.arenaFormations
        : this.originalFormations;
    if (targets.size === 0) {
      this.log("未找到竞技场阵容配置，无需恢复", "info");
      return { success: true, restored: [], failed: [], targets: {} };
    }
    this.log("十殿已结束，开始恢复各账号竞技场阵容", "info");
    await this.sleep(5_000);
    const restoredTokenIds = [];
    const failed = [];
    for (const [tokenId, rawTarget] of targets.entries()) {
      const target = numberValue(rawTarget);
      if (!target) continue;
      const client = this.client(tokenId);
      let restored = false;
      let lastError = null;
      for (let attempt = 1; attempt <= 4 && !restored; attempt += 1) {
        try {
          if (!client) throw new Error("账号连接不存在");
          // The challenge connection can keep a stale room/team state after
          // disbanding. Re-login before reading or changing the preset team.
          if (typeof client.disconnect === "function") client.disconnect();
          await this.sleep(600);
          if (!client.connected) {
            await client.connect(15_000);
          }
          await this.sleep(1_000);
          const before = await client.sendWithPromise(
            "presetteam_getinfo",
            {},
            5_000,
          );
          const current = numberValue(before?.presetTeamInfo?.useTeamId);
          if (current === target) {
            this.log(
              `${tokenLabel(this.token(tokenId))}: 当前已是竞技场阵容 ${target}，无需写入`,
              "info",
            );
            restored = true;
            break;
          }
          await client.sendWithPromise(
            "presetteam_saveteam",
            { teamId: target },
            5_000,
          );
          await this.sleep(500);
          const after = await client.sendWithPromise(
            "presetteam_getinfo",
            {},
            5_000,
          );
          const verified = numberValue(after?.presetTeamInfo?.useTeamId);
          if (verified !== target) {
            throw new Error(
              `恢复后预设阵容仍为 ${verified || "未知"}，竞技场阵容目标为 ${target}`,
            );
          }
          restored = true;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 4) {
            this.log(
              `${tokenLabel(this.token(tokenId))}: 恢复阵容暂未成功，5 秒后重新登录重试（${attempt}/4）`,
              "warning",
            );
            await this.sleep(5_000);
          }
        }
      }
      if (restored) {
        restoredTokenIds.push(tokenId);
        this.log(
          `${tokenLabel(this.token(tokenId))}: 已恢复竞技场阵容 ${target}`,
          "success",
        );
      } else {
        const reason = lastError?.message || "未知错误";
        failed.push({ tokenId, target, reason });
        this.log(
          `${tokenLabel(this.token(tokenId))}: 恢复竞技场阵容 ${target} 失败 (${reason})${
            String(reason).includes("200020")
              ? "，请检查该预设阵容是否已保存且阵容不为空"
              : ""
          }`,
          "warning",
        );
      }
    }
    return {
      success: failed.length === 0,
      restored: restoredTokenIds,
      failed,
      targets: Object.fromEntries(targets.entries()),
    };
  }

  async reuseExistingTeam(team, leaderId, leaderClient, existing) {
    this.teamId = existing.teamId;
    this.teamCleanupConfirmed = false;
    this.activeTokenIds = [];
    const teamResponse = await leaderClient.sendWithPromise(
      "matchteam_getteaminfo",
      { teamId: this.teamId },
      8_000,
    );
    const members = teamResponse?.teamInfo?.fightRoleBase || [];
    const memberMap = new Map(
      members.map((entry) => [Number(entry.roleId), entry]),
    );
    for (const memberConfig of team.members) {
      const tokenId = String(memberConfig.tokenId);
      const roleId = this.roleId(tokenId);
      if (!memberMap.has(roleId)) {
        this.log(
          `${tokenLabel(this.token(tokenId))}: 不在已创建队伍 ${this.teamId} 中，跳过`,
          "warning",
        );
        continue;
      }
      this.activeTokenIds.push(tokenId);
    }
    if (!this.activeTokenIds.includes(leaderId)) {
      this.activeTokenIds.unshift(leaderId);
    }
    if (this.activeTokenIds.length < 2) {
      throw new Error("已创建队伍中的可用配置成员不足 2 人");
    }
    for (const tokenId of this.activeTokenIds) {
      if (tokenId === leaderId) continue;
      const member = memberMap.get(this.roleId(tokenId));
      if (!member || numberValue(member.prepared) === 1) continue;
      await this.client(tokenId)
        .sendWithPromise(
          "matchteam_memberprepare",
          { teamId: this.teamId },
          8_000,
        )
        .catch((error) => {
          this.log(
            `${tokenLabel(this.token(tokenId))}: 队伍准备失败 (${error.message})`,
            "warning",
          );
        });
      await this.sleep(300);
    }
    this.log(`复用已创建队伍 ${this.teamId}，未再次修改游戏预设阵容`, "info");
    return {
      teamId: this.teamId,
      activeTokenIds: [...this.activeTokenIds],
    };
  }

  async prepareMembers(team) {
    const prepared = [];
    this.activeTokenIds = [String(team.leaderTokenId)];
    const leaderId = String(team.leaderTokenId);
    this.leaderTokenId = leaderId;
    const leaderClient = this.client(leaderId);
    if (!leaderClient) throw new Error("队长账号未连接");
    const existing = await this.currentNightmareTeam(leaderId);
    if (existing) {
      return this.reuseExistingTeam(team, leaderId, leaderClient, existing);
    }
    const leaderMember = team.members.find(
      (entry) => String(entry.tokenId) === leaderId,
    );
    const leaderFormation = await this.switchFormation(
      leaderId,
      leaderMember?.formation || 1,
    );
    if (leaderFormation?.original) {
      if (!this.originalFormations.has(leaderId)) {
        this.originalFormations.set(leaderId, leaderFormation.original);
      }
    }
    await this.syncStandaloneBattleTeam(leaderId);

    const candidateMembers = [];
    for (const memberConfig of team.members) {
      const tokenId = String(memberConfig.tokenId);
      if (tokenId === leaderId || !this.client(tokenId)) continue;
      const current = await this.currentNightmareTeam(tokenId);
      if (current) {
        this.log(
          `${tokenLabel(this.token(tokenId))}: 已在其他十殿队伍 ${current.teamId}，跳过该队员`,
          "warning",
        );
        continue;
      }
      const formation = await this.switchFormation(
        tokenId,
        memberConfig.formation,
      );
      if (formation?.original) {
        if (!this.originalFormations.has(tokenId)) {
          this.originalFormations.set(tokenId, formation.original);
        }
      }
      await this.syncStandaloneBattleTeam(tokenId);
      candidateMembers.push(tokenId);
    }

    await leaderClient.sendWithPromise(
      "matchteam_getrandteamlist",
      { teamCfgId: NIGHTMARE_TEAM_CFG_ID, param: 0, custom: {} },
      8_000,
    );
    await this.sleep(5_000);
    const created = await leaderClient.sendWithPromise(
      "matchteam_create",
      {
        teamCfgId: NIGHTMARE_TEAM_CFG_ID,
        setting: {
          name: "123",
          notice: "",
          secret: 1,
          apply: 0,
          applyList: [],
          star: 0,
        },
        param: 0,
        custom: {},
        extParam: 0,
      },
      10_000,
    );
    this.teamId = pickTeamId(created);
    if (!this.teamId) throw new Error("建队成功响应中没有 teamId");
    this.teamCleanupConfirmed = false;
    this.log(`已创建十殿队伍 ${this.teamId}`, "success");

    for (const tokenId of candidateMembers) {
      this.activeTokenIds.push(tokenId);
      try {
        await this.client(tokenId).sendWithPromise(
          "matchteam_join",
          { teamId: this.teamId },
          8_000,
        );
        prepared.push(tokenId);
        this.log(
          `${tokenLabel(this.token(tokenId))}: 已加入队伍 ${this.teamId}`,
          "success",
        );
      } catch (error) {
        if (String(error?.code || error?.message).includes("7100020")) {
          prepared.push(tokenId);
          continue;
        }
        this.log(
          `${tokenLabel(this.token(tokenId))}: 加入队伍失败，跳过 (${error.message})`,
          "warning",
        );
        this.activeTokenIds = this.activeTokenIds.filter(
          (entry) => entry !== tokenId,
        );
      }
      await this.sleep(350);
    }

    if (!this.activeTokenIds.includes(leaderId)) {
      this.activeTokenIds.unshift(leaderId);
    }
    if (this.activeTokenIds.length < 2) {
      throw new Error("可用队伍成员不足 2 人，无法开始十殿");
    }

    const teamInfo = await leaderClient.sendWithPromise(
      "matchteam_getteaminfo",
      { teamId: this.teamId },
      8_000,
    );
    const members = teamInfo?.teamInfo?.fightRoleBase || [];
    const memberMap = new Map(
      members.map((entry) => [Number(entry.roleId), entry]),
    );
    for (const tokenId of this.activeTokenIds) {
      if (tokenId === leaderId) continue;
      const roleId = this.roleId(tokenId);
      const member = memberMap.get(roleId);
      if (!member || numberValue(member.prepared) === 1) continue;
      try {
        await this.client(tokenId).sendWithPromise(
          "matchteam_memberprepare",
          { teamId: this.teamId },
          8_000,
        );
      } catch (error) {
        this.log(
          `${tokenLabel(this.token(tokenId))}: 队伍准备失败 (${error.message})`,
          "warning",
        );
      }
      await this.sleep(300);
    }
    return {
      teamId: this.teamId,
      activeTokenIds: [...this.activeTokenIds],
    };
  }

  async openRoom(team) {
    const leaderId = String(team.leaderTokenId);
    this.leaderTokenId = leaderId;
    const leaderClient = this.client(leaderId);
    await leaderClient.sendWithPromise(
      "matchteam_openteam",
      { teamId: this.teamId },
      10_000,
    );
    await this.sleep(2_500);
    for (let attempt = 0; attempt < 35 && !this.roomId; attempt += 1) {
      if (this.room.roomId) {
        this.roomId = String(this.room.roomId);
        break;
      }
      try {
        const response = await this.getRoleInfo(leaderId);
        const info = extractNightmareRoleInfo(response);
        if (info?.roomId) {
          this.roomId = String(info.roomId);
        }
      } catch {
        // Retry from the leader connection.
      }
      if (attempt > 0 && attempt % 5 === 0) {
        this.log(`开团后等待房间号 ${attempt} 秒，继续由队长连接读取`, "info");
      }
      if (!this.roomId) await this.sleep(1_000);
    }
    if (!this.roomId) throw new Error("开团后未获取到十殿 roomId");
    const roomInfo = await this.readRoom(leaderId);
    if (!roomInfo) throw new Error("未能读取十殿房间快照");
    this.log(
      `十殿房间已就绪：${this.roomId}，当前第 ${
        roomInfo.curMonsterCfgId || 1
      } 层，成员 ${roomInfo.fightRoleBase?.length || 0} 人`,
      "success",
    );
    return roomInfo;
  }

  async refreshRoom() {
    if (!this.leaderTokenId || !this.client(this.leaderTokenId)) {
      return null;
    }
    try {
      if (!this.client(this.leaderTokenId).connected) {
        await this.reconnectLeader();
      }
      return await this.readRoom(this.leaderTokenId);
    } catch (error) {
      if (isConnectionError(error) && this.client(this.leaderTokenId)) {
        try {
          await this.reconnectLeader();
          return await this.readRoom(this.leaderTokenId);
        } catch (retryError) {
          this.log(`房间状态恢复失败：${retryError.message}`, "error");
        }
      }
      return null;
    }
  }

  async restoreMainIfNeeded(team, layer) {
    const roleId = this.roleId(team.mainTokenId);
    if (!roleId) return false;
    const health = getMemberHealth(this.room, roleId);
    if (!health.damaged) return false;
    const used = numberValue(this.room.restoreCnt);
    const limit = NIGHTMARE_RESTORE_LIMITS[layer] || 1;
    if (used >= limit) {
      this.log(
        `主力有残损，但第 ${layer} 层恢复额度已用完 (${used}/${limit})，继续挑战`,
        "warning",
      );
      return false;
    }
    const leaderClient = this.client(team.leaderTokenId);
    if (!leaderClient) return false;
    try {
      await leaderClient.sendWithPromise(
        NIGHTMARE_COMMANDS.restore,
        { roomId: this.roomId, roleId },
        10_000,
      );
    } catch (error) {
      this.recordSoftError("恢复主力失败，继续使用当前状态", error);
      return false;
    }
    await this.sleep(500);
    await this.refreshRoom();
    this.log(
      `已恢复主力 ${tokenLabel(this.token(team.mainTokenId))}`,
      "success",
    );
    return true;
  }

  async waitForRoomReady(fightAt) {
    const maximumWaitAt = fightAt.getTime() + 180_000;
    while (this.now().getTime() < maximumWaitAt) {
      const info = await this.refreshRoom();
      const limitAt = numberValue(info?.fightLimitTime) * 1000;
      if (!limitAt || limitAt <= this.now().getTime()) return info;
      await this.sleep(
        Math.min(5_000, Math.max(500, limitAt - this.now().getTime())),
      );
    }
    return this.refreshRoom();
  }

  async finishFight(team, startedAt) {
    const leaderClient = await this.ensureLeaderReady(team.leaderTokenId);
    const fightResult = await this.waitForFightResult(startedAt);
    if (fightResult?.result) {
      const won = Boolean(fightResult.result.isWin);
      this.log(
        `战报已返回：${won ? "胜利" : "失败"}，总帧 ${numberValue(fightResult.result.totalFrame, "未知")}`,
        won ? "success" : "warning",
      );
    } else {
      this.log("未收到战报通知，继续按房间状态判断", "warning");
    }
    const roomBefore = await this.refreshRoom();
    if (team.fastMode) {
      await this.sleep(
        Math.max(FAST_MIN_WAIT_MS, numberValue(team.fastWaitSeconds, 5) * 1000),
      );
    } else {
      const limitAt = numberValue(roomBefore?.fightLimitTime) * 1000;
      const completeAt = limitAt
        ? Math.max(
            startedAt.getTime() + 5_000,
            limitAt + NORMAL_ANIMATION_GRACE_MS,
          )
        : startedAt.getTime() + 5_000;
      const waitMs = completeAt - this.now().getTime();
      if (waitMs > 0) await this.sleep(waitMs);
    }
    let completeError = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        await leaderClient.sendWithPromise(
          NIGHTMARE_COMMANDS.leaderComplete,
          { roomId: this.roomId },
          team.fastMode ? 3_000 : 10_000,
        );
        completeError = null;
        break;
      } catch (error) {
        completeError = error;
        if (noResponse(error)) break;
        if (
          String(error?.code || error?.message).includes("6100020") &&
          attempt < 4
        ) {
          this.log(
            `第 ${numberValue(this.room.curMonsterCfgId, "当前")} 层战斗动画尚未结束，等待后重试结束指令（${attempt}/4）`,
            "warning",
          );
          await this.sleep(3_000);
          continue;
        }
        break;
      }
    }
    if (completeError && !noResponse(completeError)) {
      this.recordSoftError(
        `第 ${numberValue(this.room.curMonsterCfgId, "当前")} 层结束指令失败，继续读取房间状态`,
        completeError,
      );
    }
    return this.waitForRoomReady(startedAt);
  }

  async waitForFightResult(startedAt) {
    const deadline = startedAt.getTime() + 15_000;
    while (this.now().getTime() < deadline) {
      if (this.latestFight) return this.latestFight;
      await this.sleep(300);
    }
    return this.latestFight;
  }

  async runOneFight(team, tokenId, layer) {
    const roleId = this.roleId(tokenId);
    if (!roleId) {
      throw new Error(`无法找到 ${tokenLabel(this.token(tokenId))} 的战斗连接`);
    }
    const leaderClient = await this.ensureLeaderReady(team.leaderTokenId);
    leaderClient.send(NIGHTMARE_COMMANDS.setFighter, {
      roomId: this.roomId,
      roleId,
    });
    await this.sleep(700);
    this.log(`第 ${layer} 层：${tokenLabel(this.token(tokenId))} 出战`, "info");
    this.latestFight = null;
    const startedAt = this.now();
    await leaderClient.sendWithPromise(
      NIGHTMARE_COMMANDS.fight,
      { roomId: this.roomId, roleId },
      30_000,
    );
    await this.sleep(1_200);
    await this.finishFight(team, startedAt);
  }

  async runLayer(team, layer) {
    let room = await this.refreshRoom();
    if (isRoomLayerCleared(room, layer)) {
      this.log(`第 ${layer} 层已通过，跳过`, "info");
      return true;
    }
    const mainRoleId = this.roleId(team.mainTokenId);
    const mainDamagedAtLayerStart =
      mainRoleId && getMemberHealth(this.room, mainRoleId).damaged;
    if (mainDamagedAtLayerStart) {
      await this.restoreMainIfNeeded(team, layer);
    }
    const order = getNightmareStageOrder(team, layer).filter((tokenId) =>
      this.activeTokenIds.includes(tokenId),
    );
    if (order.length === 0) {
      this.recordSoftError(
        `第 ${layer} 层无法继续`,
        new Error("没有可用出战成员"),
      );
      return false;
    }
    this.log(
      `第 ${layer} 层开始，出战顺序：${order
        .map((tokenId) => tokenLabel(this.token(tokenId)))
        .join(" → ")}`,
      "info",
    );
    const roomRoleIds = new Set(
      (this.room.fightRoleBase || []).map((entry) => Number(entry.roleId)),
    );
    for (const tokenId of order) {
      const roleId = this.roleId(tokenId);
      if (!roleId || (roomRoleIds.size > 0 && !roomRoleIds.has(roleId))) {
        this.log(
          `${tokenLabel(this.token(tokenId))}: 不在当前房间，跳过第 ${layer} 层`,
          "warning",
        );
        continue;
      }
      if (wasMemberUsedOnLayer(this.room, layer, roleId)) {
        this.log(
          `${tokenLabel(this.token(tokenId))}: 第 ${layer} 层已出战过，跳过`,
          "info",
        );
        continue;
      }
      const health = getMemberHealth(this.room, roleId);
      if (roleId === mainRoleId) {
        if (health.damaged && !mainDamagedAtLayerStart) {
          await this.restoreMainIfNeeded(team, layer);
        }
        const afterRestore = getMemberHealth(this.room, roleId);
        if (afterRestore.fullyDead) {
          this.log(
            `${tokenLabel(this.token(tokenId))}: 主力已全灭且无法恢复，跳过`,
            "warning",
          );
          continue;
        }
      } else if (health.fullyDead) {
        this.log(
          `${tokenLabel(this.token(tokenId))}: 五名武将全部阵亡，跳过`,
          "warning",
        );
        continue;
      }
      try {
        await this.runOneFight(team, tokenId, layer);
        room = await this.refreshRoom();
        const cleared = isRoomLayerCleared(room, layer);
        const fightWin = Boolean(this.latestFight?.result?.isWin);
        const remainingHp = getRoomLayerHp(room, layer);
        this.log(
          `第 ${layer} 层：${tokenLabel(this.token(tokenId))} 战斗结束，${
            cleared || fightWin ? "胜利" : "失败"
          }${remainingHp === null ? "" : `，Boss 剩余血量 ${remainingHp}`}`,
          cleared || fightWin ? "success" : "warning",
        );
        if (cleared || fightWin) {
          this.log(`第 ${layer} 层通关`, "success");
          return true;
        }
      } catch (error) {
        this.recordSoftError(
          `第 ${layer} 层 ${tokenLabel(this.token(tokenId))} 出战异常`,
          error,
        );
        if (isConnectionError(error)) {
          try {
            await this.ensureLeaderReady(team.leaderTokenId);
          } catch (recoveryError) {
            this.recordSoftError(
              `第 ${layer} 层队长连接恢复失败，保留房间等待人工处理`,
              recoveryError,
            );
            throw recoveryError;
          }
        }
        room = await this.refreshRoom();
        if (
          isRoomLayerCleared(room, layer) ||
          Boolean(this.latestFight?.result?.isWin)
        ) {
          this.log(`第 ${layer} 层已由战报或房间状态确认通关`, "success");
          return true;
        }
      }
    }
    this.log(`第 ${layer} 层配置成员已全部出战，仍未通关`, "error");
    return false;
  }

  async dismissChallenge(team) {
    const leaderId = String(team.leaderTokenId);
    const leaderClient = this.client(leaderId);
    if (!leaderClient) {
      throw new Error("队长账号连接不存在，无法确认解散队伍");
    }
    if (
      leaderClient.connected === false &&
      typeof leaderClient.connect === "function"
    ) {
      await leaderClient.connect(15_000);
    }
    if (this.roomId) {
      try {
        await leaderClient.sendWithPromise(
          NIGHTMARE_COMMANDS.dismissRoom,
          { roomId: this.roomId },
          8_000,
        );
        this.log(`已退出十殿房间 ${this.roomId}`, "success");
      } catch (error) {
        if (!String(error?.code || error?.message).includes("6100010")) {
          this.log(
            `退出十殿房间 ${this.roomId} 暂未成功，继续解散队伍：${error.message}`,
            "warning",
          );
        }
      }
    }

    let matchTeamId = String(this.teamId || "");
    if (!matchTeamId) {
      const current = await this.currentNightmareTeam(leaderId);
      matchTeamId = String(current?.teamId || "");
    }

    if (matchTeamId) {
      let confirmed = false;
      let lastError = null;
      for (let attempt = 1; attempt <= 3 && !confirmed; attempt += 1) {
        try {
          await leaderClient.sendWithPromise(
            "matchteam_dismiss",
            { teamId: matchTeamId },
            8_000,
          );
        } catch (error) {
          const code = String(error?.code || error?.message);
          if (!code.includes("7100010") && !code.includes("7800320")) {
            lastError = error;
          }
        }
        await this.sleep(1_000);
        try {
          const current = await this.currentNightmareTeam(leaderId);
          confirmed = String(current?.teamId || "") !== matchTeamId;
          if (!confirmed) {
            this.log(
              `十殿队伍 ${matchTeamId} 仍在游戏中，重试解散（${attempt}/3）`,
              "warning",
            );
          }
        } catch (error) {
          lastError = error;
          if (attempt < 3) {
            this.log(
              `解散后暂未读取到队伍状态，稍后重试（${attempt}/3）：${error.message}`,
              "warning",
            );
          }
        }
      }
      if (!confirmed) {
        throw new Error(
          `未能确认十殿队伍 ${matchTeamId} 已解散${
            lastError ? `：${lastError.message}` : ""
          }`,
        );
      }
      this.log(`十殿队伍 ${matchTeamId} 已确认解散`, "success");
    } else {
      const current = await this.currentNightmareTeam(leaderId);
      if (current?.teamId) {
        throw new Error(
          `读取到未解散的十殿队伍 ${current.teamId}，无法确认收尾状态`,
        );
      }
    }

    this.teamCleanupConfirmed = true;
    this.log("十殿收尾完成：房间已关闭，队伍已解散", "success");
    this.roomId = "";
    this.teamId = "";
    this.room = {};
    await this.sleep(2_000);
  }

  async initializeRoleIds() {
    for (const tokenId of this.clients.keys()) {
      const roleId = this.roleId(tokenId);
      if (roleId) this.roleIds.set(String(tokenId), roleId);
    }
  }

  async prepare(team) {
    this.attachRoomListeners();
    await this.initializeRoleIds();
    try {
      const result = await this.prepareMembers(team);
      this.log(
        `队伍准备完成：${this.activeTokenIds
          .map((tokenId) => tokenLabel(this.token(tokenId)))
          .join("、")}`,
        "success",
      );
      return result;
    } finally {
      this.dispose();
    }
  }

  async runChallenge(
    team,
    {
      state = {},
      saveState = async () => {},
      onPause = null,
      onResume = null,
    } = {},
  ) {
    this.attachRoomListeners();
    await this.initializeRoleIds();
    this.leaderTokenId = String(team.leaderTokenId);
    if (isObject(team.arenaFormations)) {
      this.arenaFormations = new Map(Object.entries(team.arenaFormations));
    }
    let attempt = Math.max(1, numberValue(state.attempt, 1));
    let resumed = Boolean(state.roomId && state.phase === "paused-cross-week");
    let startLayer = resumed ? Math.max(1, numberValue(state.layer, 1)) : 1;
    if (resumed) {
      this.roomId = String(state.roomId);
      this.teamId = String(state.teamMatchId || "");
      this.teamCleanupConfirmed = false;
      this.activeTokenIds = Array.isArray(state.activeTokenIds)
        ? state.activeTokenIds
        : team.members.map((entry) => entry.tokenId);
      if (isObject(state.originalFormations)) {
        this.originalFormations = new Map(
          Object.entries(state.originalFormations),
        );
      }
    } else if (isObject(state.originalFormations)) {
      this.originalFormations = new Map(
        Object.entries(state.originalFormations),
      );
    }
    try {
      while (attempt <= team.maxAttempts) {
        if (!resumed) {
          const existingRoom = await this.findExistingRoom(team);
          if (existingRoom) {
            resumed = true;
            startLayer = Math.max(
              1,
              numberValue(existingRoom.curMonsterCfgId, 1),
            );
            await saveState({
              taskId: state.taskId,
              teamId: team.id,
              phase: "running",
              attempt,
              layer: startLayer,
              roomId: this.roomId,
              teamMatchId: this.teamId,
              activeTokenIds: [...this.activeTokenIds],
              originalFormations: this.formationState(),
              crossWeekPaused: Boolean(state.crossWeekPaused),
              updatedAt: this.now().toISOString(),
            });
          }
        }
        if (!resumed) {
          // A previous failed/incomplete run may have saved layer 8. Once a
          // new room is opened, the authoritative start layer is always 1.
          startLayer = 1;
          const prepared = await this.prepareMembers(team);
          this.log(`第 ${attempt}/${team.maxAttempts} 次挑战开始`, "info");
          await this.openRoom(team);
          await saveState({
            taskId: state.taskId,
            teamId: team.id,
            phase: "running",
            attempt,
            layer: 1,
            roomId: this.roomId,
            teamMatchId: prepared.teamId,
            activeTokenIds: [...this.activeTokenIds],
            originalFormations: this.formationState(),
            updatedAt: this.now().toISOString(),
          });
        }
        let attemptFailed = false;
        for (let layer = startLayer; layer <= 8; layer += 1) {
          if (
            shouldPauseForCrossWeek(team, layer, this.now()) &&
            !state.crossWeekPaused
          ) {
            const resumeAt = team.forceCrossWeek
              ? getNextShanghaiMidnight(this.now())
              : getNextMondayMidnight(this.now());
            const pausedState = {
              taskId: state.taskId,
              teamId: team.id,
              phase: "paused-cross-week",
              attempt,
              layer,
              roomId: this.roomId,
              teamMatchId: this.teamId,
              activeTokenIds: [...this.activeTokenIds],
              originalFormations: this.formationState(),
              crossWeekPaused: true,
              resumeAt: resumeAt.toISOString(),
              updatedAt: this.now().toISOString(),
            };
            await saveState(pausedState);
            this.log(
              `跨周暂停：等待 ${resumeAt.toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
                hour12: false,
              })} 后挑战第 8 层`,
              "warning",
            );
            if (onPause) await onPause(pausedState);
            while (this.now().getTime() < resumeAt.getTime()) {
              await this.sleep(
                Math.min(60_000, resumeAt.getTime() - this.now().getTime()),
              );
            }
            if (onResume) {
              const resumedClients = await onResume(pausedState);
              if (resumedClients) {
                this.clients = resumedClients;
                this.attachRoomListeners();
                await this.initializeRoleIds();
              }
            }
            this.log("跨周暂停结束，已重新连接账号并读取房间", "success");
            state.crossWeekPaused = true;
            const resumedRoom = await this.readRoom(this.leaderTokenId);
            const resumedLayer = numberValue(resumedRoom?.curMonsterCfgId);
            if (
              !resumedRoom ||
              (resumedLayer > 0 &&
                resumedLayer < 8 &&
                !isRoomLayerCleared(resumedRoom, 7))
            ) {
              throw new Error(
                "跨周恢复后房间进度不在第八层，已停止以避免重复消耗",
              );
            }
          }
          const cleared = await this.runLayer(team, layer);
          if (!cleared) {
            attemptFailed = true;
            this.log(`第 ${attempt} 次挑战在第 ${layer} 层失败`, "error");
            break;
          }
          await saveState({
            taskId: state.taskId,
            teamId: team.id,
            phase: "running",
            attempt,
            layer: layer + 1,
            roomId: this.roomId,
            teamMatchId: this.teamId,
            activeTokenIds: [...this.activeTokenIds],
            originalFormations: this.formationState(),
            crossWeekPaused: Boolean(state.crossWeekPaused),
            updatedAt: this.now().toISOString(),
          });
        }
        if (!attemptFailed) {
          this.log(
            `第 ${attempt}/${team.maxAttempts} 次挑战完成 1-8 层`,
            "success",
          );
          const completedRoomId = this.roomId;
          await this.dismissChallenge(team);
          return {
            success: true,
            attempts: attempt,
            roomId: completedRoomId,
          };
        }
        await this.dismissChallenge(team);
        attempt += 1;
        this.log(
          attempt <= team.maxAttempts
            ? `准备从第一层重新开始第 ${attempt}/${team.maxAttempts} 次挑战`
            : `已达到最多 ${team.maxAttempts} 次挑战，停止重试`,
          attempt <= team.maxAttempts ? "warning" : "error",
        );
        startLayer = 1;
        resumed = false;
      }
      return { success: false, attempts: team.maxAttempts };
    } catch (error) {
      this.log(
        `十殿流程暂停，保留队伍和房间等待人工处理：${error.message}`,
        "error",
      );
      throw error;
    } finally {
      this.logSoftErrorSummary();
      if (this.teamCleanupConfirmed) {
        await this.restoreFormations();
      } else {
        this.log(
          "未确认十殿队伍已解散，跳过恢复预设阵容，避免半途恢复失败",
          "warning",
        );
      }
      this.dispose();
    }
  }
}

function roleServerId(roleResponse) {
  const role = roleResponse?.role || roleResponse || {};
  return numberValue(
    role.serverId ??
      role.serverID ??
      role.server_id ??
      roleResponse?.serverId ??
      roleResponse?.serverID,
  );
}

function charmLeftMap(response) {
  return normalizeNumberMap(
    response?.charmLeftNumMap ||
      response?.getData?.()?.charmLeftNumMap ||
      response,
  );
}

function charmCost(layer) {
  return CHARM_COSTS[layer] || 10;
}

export function getWaitUntilDelay(waitUntil, nowMs = Date.now()) {
  const match = String(waitUntil || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return 0;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(nowMs))
      .filter((entry) => entry.type !== "literal")
      .map((entry) => [entry.type, entry.value]),
  );
  let target = Date.parse(
    `${parts.year}-${parts.month}-${parts.day}T${match[1]}:${match[2]}:00+08:00`,
  );
  if (target <= nowMs) target += 24 * 60 * 60 * 1000;
  const delay = target - nowMs;
  return delay <= 2 * 60 * 60 * 1000 ? delay : 0;
}

export async function runCharmPurchaseForClient({
  client,
  token,
  charmSettings,
  waitUntil = "",
  log = () => {},
  sleep = defaultSleep,
  now = () => Date.now(),
}) {
  const settings = normalizeNightmareCharmSettings(charmSettings);
  const waitDelay = getWaitUntilDelay(waitUntil, now());
  if (waitDelay > 0) {
    log(`抢符任务已提前占位，将在 ${waitUntil} 开始查询和购买`, "info");
    await sleep(waitDelay);
  }
  const roleId = tokenRoleId(token);
  const roleResponse = await client.sendWithPromise(
    "role_getroleinfo",
    {},
    15_000,
  );
  const serverId = roleServerId(roleResponse);
  let roleInfo = await client.sendWithPromise(
    NIGHTMARE_COMMANDS.getRoleInfo,
    { roleId },
    10_000,
  );
  let nightmareInfo = extractNightmareRoleInfo(roleInfo) || {};
  let counts = areCharmCountsCurrent(roleInfo, new Date(now()))
    ? getCharmCounts(roleInfo)
    : {};
  const purchased = [];
  const skipped = [];
  const targetLayers = [1, 2, 3, 4, 5, 6].filter(
    (layer) => numberValue(settings.targets[layer]) > 0,
  );
  if (targetLayers.length === 0) {
    return {
      cmd: "nightmareCharmPurchase",
      success: true,
      status: "warning",
      message: "该定时任务没有选择任何符咒层，本次未查询库存或购买",
      purchased,
      skipped: [],
      alreadyOwned: [],
      missing: [],
      counts,
    };
  }
  const alreadyOwned = targetLayers.filter(
    (layer) =>
      numberValue(counts[layer]) >= numberValue(settings.targets[layer]),
  );
  for (const layer of alreadyOwned) {
    log(
      `第 ${layer} 层符咒已拥有 ${numberValue(counts[layer])} 张，无需购买`,
      "info",
    );
  }
  let needs = getCharmInventoryNeeds(
    counts,
    settings.targets,
    settings.priority,
  );
  if (needs.length === 0) {
    return {
      cmd: "nightmareCharmPurchase",
      success: true,
      status: "info",
      message: `所选第 ${targetLayers.join("、")} 层符咒均已满足目标数量；已拥有跳过 ${alreadyOwned.join("、") || "无"}`,
      purchased,
      alreadyOwned,
      missing: [],
      counts,
    };
  }
  let lastLeft = {};
  try {
    const leftResponse = await client.sendWithPromise(
      NIGHTMARE_COMMANDS.getCharm,
      { serverId },
      10_000,
    );
    lastLeft = charmLeftMap(leftResponse);
  } catch (error) {
    log(`查询符咒库存失败，本次不抢：${error.message}`, "warning");
    return {
      cmd: "nightmareCharmPurchase",
      success: true,
      status: "warning",
      message: `查询符咒库存失败，本次未购买：${error.message}`,
      purchased,
      alreadyOwned,
      missing: needs.map((need) => ({ ...need, reason: "库存查询失败" })),
      counts,
    };
  }
  for (const need of needs) {
    let current = need.current;
    let stopReason = "";
    while (current < need.target) {
      const love = numberValue(nightmareInfo.love);
      if (love < charmCost(need.layer)) {
        stopReason = "爱心不足";
        log(
          `第 ${need.layer} 层符咒未抢到：爱心不足（需要 ${charmCost(need.layer)}，当前 ${love}）`,
          "warning",
        );
        break;
      }
      if (numberValue(lastLeft[need.layer]) <= 0) {
        stopReason = "商店库存不足";
        log(
          `第 ${need.layer} 层符咒未抢到：商店库存不足，不轮询等待`,
          "warning",
        );
        break;
      }
      try {
        const previous = current;
        const bought = await client.sendWithPromise(
          NIGHTMARE_COMMANDS.buyCharm,
          {
            charmId: need.layer,
            buyNum: 1,
          },
          10_000,
        );
        const result = bought?.getData?.() || bought || {};
        if (result.success === false) {
          stopReason = "购买未成功";
          log(`第 ${need.layer} 层符咒购买未成功`, "warning");
          break;
        }
        current = Number.isFinite(Number(result.num))
          ? Number(result.num)
          : current + 1;
        if (current <= previous) {
          current = previous;
          stopReason = "购买后数量未更新";
          log(`第 ${need.layer} 层符咒购买后数量未更新，停止该层`, "warning");
          break;
        }
        if (Number.isFinite(Number(result.love))) {
          nightmareInfo.love = Number(result.love);
        } else {
          nightmareInfo.love = Math.max(
            0,
            numberValue(nightmareInfo.love) - charmCost(need.layer),
          );
        }
        if (isObject(result.charmLeftNumMap)) {
          lastLeft = normalizeNumberMap(result.charmLeftNumMap);
        } else {
          lastLeft[need.layer] = Math.max(
            0,
            numberValue(lastLeft[need.layer]) - 1,
          );
        }
        purchased.push({
          layer: need.layer,
          count: current,
          love: numberValue(result.love, nightmareInfo.love),
        });
        log(
          `已抢到第 ${need.layer} 层符咒 ${current}/${need.target}，当前持有 ${current} 张`,
          "success",
        );
      } catch (error) {
        stopReason = `购买失败: ${error.message}`;
        log(`第 ${need.layer} 层符咒购买失败：${error.message}`, "warning");
        break;
      }
      await sleep(CHARM_BUY_COOLDOWN_MS);
    }
    if (current < need.target) {
      skipped.push({
        ...need,
        current,
        reason: stopReason || "未完成",
      });
    }
  }
  roleInfo = await client.sendWithPromise(
    NIGHTMARE_COMMANDS.getRoleInfo,
    { roleId },
    10_000,
  );
  nightmareInfo = extractNightmareRoleInfo(roleInfo) || {};
  counts = areCharmCountsCurrent(roleInfo, new Date(now()))
    ? getCharmCounts(roleInfo)
    : {};
  needs = getCharmInventoryNeeds(counts, settings.targets, settings.priority);
  const missing = needs.map((need) => {
    const known = skipped.find((entry) => entry.layer === need.layer);
    return {
      ...need,
      reason:
        known?.reason ||
        (numberValue(lastLeft[need.layer]) <= 0 ? "商店库存不足" : "未完成"),
    };
  });
  if (needs.length === 0) {
    return {
      cmd: "nightmareCharmPurchase",
      success: true,
      status: skipped.length ? "warning" : "success",
      message: `所选层符咒目标已完成；已拥有 ${alreadyOwned.join("、") || "无"}；本次抢到 ${purchased.map((entry) => entry.layer).join("、") || "无"}`,
      purchased,
      skipped,
      alreadyOwned,
      missing: [],
      counts,
    };
  }
  const missingText = missing
    .map((entry) => `第${entry.layer}层（${entry.reason}）`)
    .join("、");
  const summary = `所选层符咒未补齐：${missingText}；本次抢到 ${purchased.map((entry) => entry.layer).join("、") || "无"}；已拥有跳过 ${alreadyOwned.join("、") || "无"}`;
  log(summary, "warning");
  return {
    cmd: "nightmareCharmPurchase",
    success: true,
    status: "warning",
    message: summary,
    purchased,
    skipped,
    alreadyOwned,
    missing,
    counts,
  };
}
