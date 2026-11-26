import assert from "node:assert/strict";
import test from "node:test";
import {
  getArenaFormation,
  getArenaFormationMap,
  getCharmInventoryNeeds,
  getMemberHealth,
  getNextMondayMidnight,
  getWaitUntilDelay,
  isRoomLayerCleared,
  NightmareRunner,
  runCharmPurchaseForClient,
  shouldPauseForCrossWeek,
  wasMemberUsedOnLayer,
} from "../render-backend/lib/nightmareRunner.js";
import {
  getNightmareStageOrder,
  nightmareMemberMatchesRole,
  normalizeNightmareSettings,
  validateNightmareSettings,
} from "../render-backend/lib/nightmareSettings.js";

function team(overrides = {}) {
  return {
    id: "team-a",
    name: "测试十殿",
    enabled: true,
    leaderTokenId: "a",
    mainTokenId: "a",
    members: [
      { tokenId: "a", formation: 1 },
      { tokenId: "b", formation: 2 },
      { tokenId: "c", formation: 3 },
    ],
    stages: [1, 2, 3, 4, 5, 6, 7, 8].map((layer) => ({
      layer,
      order: ["a", "b", "c"],
    })),
    maxAttempts: 3,
    fastMode: false,
    fastWaitSeconds: 5,
    crossWeek: true,
    ...overrides,
  };
}

test("nightmare settings keep three teams, presets and ordered stage plans", () => {
  const settings = normalizeNightmareSettings({
    teams: [team()],
    charm: { priority: [5, 2, 5], targets: { 2: 2 } },
  });
  assert.equal(settings.teams.length, 1);
  assert.deepEqual(settings.teams[0].members, [
    { tokenId: "a", formation: 1 },
    { tokenId: "b", formation: 2 },
    { tokenId: "c", formation: 3 },
  ]);
  assert.deepEqual(getNightmareStageOrder(settings.teams[0], 7), [
    "a",
    "b",
    "c",
  ]);
  assert.deepEqual(settings.charm.priority, [5, 2, 1, 3, 4, 6]);
  assert.equal(settings.charm.targets[2], 2);
  assert.equal(settings.teams[0].maxRetries, 2);
  assert.equal(settings.teams[0].maxAttempts, 3);
});

test("nightmare retry configuration can disable retries", () => {
  const settings = normalizeNightmareSettings({
    teams: [team({ maxRetries: 0, maxAttempts: 3 })],
  });
  assert.equal(settings.teams[0].maxRetries, 0);
  assert.equal(settings.teams[0].maxAttempts, 1);
});

test("nightmare validation rejects missing leaders and duplicate team accounts", () => {
  const invalidTeam = team({ leaderTokenId: "" });
  const validation = validateNightmareSettings({
    teams: [invalidTeam, { ...team({ id: "team-b" }), name: "重复账号" }],
  });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("；"), /队长/);
  assert.match(validation.errors.join("；"), /同时出现在多套十殿队伍中/);
});

test("main-role detection falls back to the stable role suffix in the member name", () => {
  assert.equal(
    nightmareMemberMatchesRole(
      { roleId: 92373121, name: "安安-0-101336362" },
      101336362,
    ),
    true,
  );
  assert.equal(
    nightmareMemberMatchesRole(
      { roleId: 92373121, name: "其他账号" },
      101336362,
    ),
    false,
  );
});

test("charm purchase plan prioritizes layers 2 and 5 and only fills missing counts", () => {
  const needs = getCharmInventoryNeeds(
    { 1: 1, 2: 0, 3: 1, 4: 1, 5: 0, 6: 1 },
    { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 },
    [2, 5, 1, 3, 4, 6],
  );
  assert.deepEqual(
    needs.map((entry) => entry.layer),
    [2, 5],
  );
});

test("cross-week pause targets Monday midnight in Shanghai time", () => {
  const sunday2330 = new Date("2026-11-22T15:30:00.000Z");
  const mondayReset = getNextMondayMidnight(sunday2330);
  assert.equal(mondayReset.toISOString(), "2026-11-22T16:00:00.000Z");
  assert.equal(shouldPauseForCrossWeek(team(), 7, sunday2330), false);
  assert.equal(shouldPauseForCrossWeek(team(), 8, sunday2330), true);
  assert.equal(
    shouldPauseForCrossWeek(team(), 8, new Date("2026-11-22T16:01:00.000Z")),
    false,
  );
});

test("forced cross-week simulation pauses on any day before local midnight", () => {
  const monday2330 = new Date("2026-11-23T15:30:00.000Z");
  assert.equal(
    shouldPauseForCrossWeek(team({ forceCrossWeek: true }), 8, monday2330),
    true,
  );
  assert.equal(
    shouldPauseForCrossWeek(
      team({ forceCrossWeek: true }),
      8,
      new Date("2026-11-23T16:01:00.000Z"),
    ),
    false,
  );
  assert.equal(
    getWaitUntilDelay("12:00", Date.parse("2026-11-23T03:59:00.000Z")),
    60_000,
  );
});

test("member health distinguishes partial damage, full death and attack usage", () => {
  const room = {
    fightRoleBase: [
      {
        roleId: 101,
        battleData: {
          team: {
            0: { id: 1, hp: 100 },
            1: { id: 2, hp: 100 },
          },
        },
      },
    ],
    playerTeamInfo: {
      101: {
        curHeroData: {
          1: { curHp: 50 },
          2: { curHp: 0 },
        },
      },
    },
    monsterTeamInfo: {
      7: {
        totalAttacked: 1,
        fightSnapData: { 101: { attackedNum: 1 } },
      },
    },
  };
  assert.deepEqual(
    {
      alive: getMemberHealth(room, 101).alive,
      damaged: getMemberHealth(room, 101).damaged,
      fullyDead: getMemberHealth(room, 101).fullyDead,
    },
    { alive: 1, damaged: true, fullyDead: false },
  );
  room.playerTeamInfo[101].curHeroData = {
    1: { curHp: 0 },
    2: { curHp: 0 },
  };
  assert.equal(getMemberHealth(room, 101).fullyDead, true);
  assert.equal(wasMemberUsedOnLayer(room, 7, 101), true);
});

test("room layer is cleared only after the boss has damage and all units are zero", () => {
  assert.equal(
    isRoomLayerCleared(
      {
        curMonsterCfgId: 2,
        monsterTeamInfo: {
          2: {
            totalAttacked: 0,
            curMonsterData: { 10002: { curHp: 0 } },
          },
        },
      },
      2,
    ),
    false,
  );
  assert.equal(
    isRoomLayerCleared(
      {
        curMonsterCfgId: 3,
        monsterTeamInfo: {
          2: {
            totalAttacked: 1,
            curMonsterData: { 10002: { curHp: 0 } },
          },
        },
      },
      2,
    ),
    true,
  );
});

test("charm task buys missing layers in priority order and stops at target", async () => {
  const counts = { 1: 1, 2: 0, 3: 1, 4: 1, 5: 0, 6: 1 };
  let love = 1000;
  const calls = [];
  const client = {
    async sendWithPromise(cmd, params = {}) {
      calls.push({ cmd, params });
      if (cmd === "role_getroleinfo") {
        return { role: { roleId: 101, serverId: 9 } };
      }
      if (cmd === "nightmare_getroleinfo") {
        return {
          nightMareData: {
            roleId: 101,
            love,
            charmData: { ...counts },
          },
        };
      }
      if (cmd === "nightmare_getcharm") {
        return {
          charmLeftNumMap: { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10 },
        };
      }
      if (cmd === "nightmare_buycharm") {
        counts[params.charmId] += 1;
        love -= params.charmId <= 3 ? 10 : params.charmId === 4 ? 20 : 30;
        return {
          success: true,
          charmId: params.charmId,
          num: counts[params.charmId],
          love,
        };
      }
      return {};
    },
  };

  const result = await runCharmPurchaseForClient({
    client,
    token: { id: "a", name: "主力-101" },
    charmSettings: {
      priority: [2, 5, 1, 3, 4, 6],
      targets: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 },
      pollIntervalMs: 2000,
      pollDurationMs: 2000,
    },
    sleep: async () => {},
    now: () => 1,
  });

  assert.equal(result.success, true);
  assert.equal(result.status, "success");
  assert.deepEqual(
    calls
      .filter((entry) => entry.cmd === "nightmare_buycharm")
      .map((entry) => entry.params.charmId),
    [2, 5],
  );
});

test("cross-account challenge stops after three full challenge attempts", async () => {
  const runner = new NightmareRunner({
    clients: new Map(),
    tokens: new Map(),
    log: () => {},
    sleep: async () => {},
    now: () => new Date("2026-11-23T02:00:00.000Z"),
  });
  let attempts = 0;
  let opened = 0;
  let dismissed = 0;
  runner.attachRoomListeners = () => {};
  runner.dispose = () => {};
  runner.initializeRoleIds = async () => {};
  runner.restoreFormations = async () => {};
  runner.prepareMembers = async () => {
    attempts += 1;
    runner.activeTokenIds = ["a", "b"];
    runner.teamId = `team-${attempts}`;
    return { teamId: runner.teamId, activeTokenIds: ["a", "b"] };
  };
  runner.openRoom = async () => {
    opened += 1;
    runner.roomId = `room-${opened}`;
  };
  runner.dismissChallenge = async () => {
    dismissed += 1;
  };
  runner.runLayer = async () => false;

  const result = await runner.runChallenge(team(), {
    state: { taskId: "task-a" },
  });

  assert.deepEqual(result, { success: false, attempts: 3 });
  assert.equal(attempts, 3);
  assert.equal(opened, 3);
  assert.equal(dismissed, 3);
});

test("successful challenge is dismissed before preset formations are restored", async () => {
  const order = [];
  const runner = new NightmareRunner({
    clients: new Map(),
    tokens: new Map(),
    sleep: async () => {},
    now: () => new Date("2026-11-23T02:00:00.000Z"),
  });
  runner.attachRoomListeners = () => {};
  runner.dispose = () => {};
  runner.initializeRoleIds = async () => {};
  runner.prepareMembers = async () => {
    runner.teamId = "match-team-1";
    runner.activeTokenIds = ["a", "b"];
    return { teamId: runner.teamId, activeTokenIds: ["a", "b"] };
  };
  runner.openRoom = async () => {
    runner.roomId = "room-1";
  };
  runner.runLayer = async () => true;
  runner.dismissChallenge = async () => {
    order.push("dismiss");
    runner.teamCleanupConfirmed = true;
  };
  runner.restoreFormations = async () => {
    order.push("restore");
  };

  const result = await runner.runChallenge(team({ maxAttempts: 1 }), {
    state: { taskId: "task-a" },
  });

  assert.deepEqual(result, {
    success: true,
    attempts: 1,
    roomId: "room-1",
  });
  assert.deepEqual(order, ["dismiss", "restore"]);
});

test("a newly opened room ignores a stale saved layer and starts from layer 1", async () => {
  const layers = [];
  const runner = new NightmareRunner({
    clients: new Map(),
    tokens: new Map(),
    sleep: async () => {},
    now: () => new Date("2026-11-23T02:00:00.000Z"),
  });
  runner.attachRoomListeners = () => {};
  runner.dispose = () => {};
  runner.initializeRoleIds = async () => {};
  runner.findExistingRoom = async () => null;
  runner.prepareMembers = async () => {
    runner.teamId = "match-team-1";
    runner.activeTokenIds = ["a", "b"];
    return { teamId: runner.teamId, activeTokenIds: ["a", "b"] };
  };
  runner.openRoom = async () => {
    runner.roomId = "room-new";
  };
  runner.runLayer = async (_team, layer) => {
    layers.push(layer);
    return true;
  };
  runner.dismissChallenge = async () => {
    runner.teamCleanupConfirmed = true;
  };
  runner.restoreFormations = async () => {};

  const result = await runner.runChallenge(team({ maxAttempts: 1 }), {
    state: {
      taskId: "task-a",
      phase: "running",
      attempt: 1,
      layer: 8,
      roomId: "expired-room",
    },
  });

  assert.equal(result.success, true);
  assert.deepEqual(layers, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("resumed challenge uses the match team id instead of the configuration id", async () => {
  const runner = new NightmareRunner({
    clients: new Map(),
    tokens: new Map(),
    sleep: async () => {},
    now: () => new Date("2026-11-23T02:00:00.000Z"),
  });
  runner.attachRoomListeners = () => {};
  runner.dispose = () => {};
  runner.initializeRoleIds = async () => {};
  runner.readRoom = async () => ({ curMonsterCfgId: 8 });
  runner.runLayer = async () => false;
  runner.dismissChallenge = async () => {
    assert.equal(runner.teamId, "match-team-104");
    runner.teamCleanupConfirmed = true;
  };
  runner.restoreFormations = async () => {};

  await runner.runChallenge(team({ maxAttempts: 1 }), {
    state: {
      taskId: "task-a",
      teamId: "nightmare-team-1",
      teamMatchId: "match-team-104",
      roomId: "room-1",
      phase: "paused-cross-week",
      layer: 8,
      attempt: 1,
      activeTokenIds: ["a", "b"],
    },
  });
});

test("dismissChallenge finds the real match team through the leader and verifies it is gone", async () => {
  const calls = [];
  let currentTeam = "match-team-104";
  const leaderClient = {
    connected: true,
    async sendWithPromise(cmd, params) {
      calls.push({ cmd, params });
      if (cmd === "matchteam_dismiss") currentTeam = "";
      return {};
    },
  };
  const memberClient = {
    async sendWithPromise() {
      throw new Error("members must not send disband commands");
    },
  };
  const runner = new NightmareRunner({
    clients: new Map([
      ["a", leaderClient],
      ["b", memberClient],
    ]),
    tokens: new Map([
      ["a", { id: "a", name: "队长-101" }],
      ["b", { id: "b", name: "队员-102" }],
    ]),
    sleep: async () => {},
  });
  runner.roleIds.set("a", 101);
  runner.roomId = "room-1";
  runner.currentNightmareTeam = async (tokenId) => {
    assert.equal(tokenId, "a");
    return currentTeam ? { teamId: currentTeam, teamCfgId: 1 } : null;
  };

  await runner.dismissChallenge(team({ leaderTokenId: "a" }));

  assert.equal(runner.teamCleanupConfirmed, true);
  assert.deepEqual(
    calls.map((entry) => entry.cmd),
    ["nightmare_dismiss", "matchteam_dismiss"],
  );
  assert.equal(calls[1].params.teamId, "match-team-104");
});

test("leader connection is restored automatically after the socket is kicked", async () => {
  let connectCount = 0;
  const leaderClient = {
    connected: false,
    async connect() {
      connectCount += 1;
      this.connected = true;
    },
    async sendWithPromise(cmd) {
      assert.equal(cmd, "role_getroleinfo");
      return { role: { roleId: 101 } };
    },
  };
  const runner = new NightmareRunner({
    clients: new Map([["a", leaderClient]]),
    tokens: new Map([["a", { id: "a", name: "队长-101" }]]),
    sleep: async () => {},
  });
  runner.roleIds.set("a", 101);

  const client = await runner.ensureLeaderReady("a");

  assert.equal(client, leaderClient);
  assert.equal(connectCount, 1);
  assert.equal(leaderClient.connected, true);
});

test("switchFormation sets and verifies a target when the current preset is unknown", async () => {
  const calls = [];
  let currentFormation = 0;
  const client = {
    async sendWithPromise(cmd, params) {
      calls.push({ cmd, params });
      if (cmd === "presetteam_getinfo") {
        return { presetTeamInfo: { useTeamId: currentFormation } };
      }
      if (cmd === "presetteam_saveteam") {
        currentFormation = params.teamId;
        return {};
      }
      throw new Error(`unexpected command ${cmd}`);
    },
  };
  const runner = new NightmareRunner({
    clients: new Map([["a", client]]),
    tokens: new Map([["a", { id: "a", name: "队长-101" }]]),
    sleep: async () => {},
  });

  const result = await runner.switchFormation("a", 1);

  assert.deepEqual(result, { original: 0, target: 1 });
  assert.deepEqual(
    calls.map((entry) => entry.cmd),
    ["presetteam_getinfo", "presetteam_saveteam", "presetteam_getinfo"],
  );
});

test("finishFight retries leader completion while the battle animation is still running", async () => {
  const calls = [];
  let completeAttempts = 0;
  const leaderClient = {
    async sendWithPromise(cmd) {
      calls.push(cmd);
      if (cmd === "nightmare_leadercomplete") {
        completeAttempts += 1;
        if (completeAttempts < 3) {
          const error = new Error("[6100020] 房间战斗中，不能设置");
          error.code = 6100020;
          throw error;
        }
      }
      return {};
    },
  };
  const runner = new NightmareRunner({
    clients: new Map([["a", leaderClient]]),
    tokens: new Map([["a", { id: "a", name: "队长-101" }]]),
    sleep: async () => {},
    now: () => new Date("2026-11-24T00:00:10.000Z"),
  });
  runner.refreshRoom = async () => ({ fightLimitTime: 0 });
  runner.waitForRoomReady = async () => ({ curMonsterCfgId: 2 });
  runner.waitForFightResult = async () => null;

  await runner.finishFight(
    team({ leaderTokenId: "a", fastMode: true }),
    new Date("2026-11-24T00:00:00.000Z"),
  );

  assert.equal(completeAttempts, 3);
  assert.deepEqual(calls, [
    "nightmare_leadercomplete",
    "nightmare_leadercomplete",
    "nightmare_leadercomplete",
  ]);
});

test("runLayer continues when a command error still leaves the layer cleared", async () => {
  let refreshCount = 0;
  const roomAtLayerOne = {
    curMonsterCfgId: 1,
    fightRoleBase: [{ roleId: 101 }, { roleId: 102 }],
  };
  const roomAfterClear = {
    curMonsterCfgId: 2,
    fightRoleBase: [{ roleId: 101 }, { roleId: 102 }],
  };
  const runner = new NightmareRunner({
    clients: new Map(),
    tokens: new Map([
      ["a", { id: "a", name: "队长-101" }],
      ["b", { id: "b", name: "队员-102" }],
    ]),
    sleep: async () => {},
  });
  runner.activeTokenIds = ["a", "b"];
  runner.roleIds.set("a", 101);
  runner.roleIds.set("b", 102);
  runner.room = roomAtLayerOne;
  runner.refreshRoom = async () => {
    refreshCount += 1;
    return refreshCount === 1 ? roomAtLayerOne : roomAfterClear;
  };
  runner.runOneFight = async () => {
    const error = new Error("[6100020] 房间战斗中，不能设置");
    error.code = 6100020;
    throw error;
  };

  const cleared = await runner.runLayer(
    team({
      leaderTokenId: "a",
      mainTokenId: "a",
      members: [
        { tokenId: "a", formation: 1 },
        { tokenId: "b", formation: 1 },
      ],
      stages: [
        { layer: 1, order: ["a", "b"] },
        { layer: 2, order: ["a"] },
      ],
    }),
    1,
  );

  assert.equal(cleared, true);
  assert.equal(runner.softErrors.length, 1);
  assert.equal(refreshCount >= 1, true);
});

test("formation restore reconnects and verifies the preset before writing", async () => {
  const calls = [];
  let currentFormation = 3;
  const client = {
    connected: true,
    disconnect() {
      calls.push("disconnect");
      this.connected = false;
    },
    async connect() {
      calls.push("connect");
      this.connected = true;
    },
    async sendWithPromise(cmd, params) {
      calls.push({ cmd, params });
      if (cmd === "presetteam_getinfo") {
        return { presetTeamInfo: { useTeamId: currentFormation } };
      }
      if (cmd === "presetteam_saveteam") {
        currentFormation = params.teamId;
        return {};
      }
      throw new Error(`unexpected command ${cmd}`);
    },
  };
  const runner = new NightmareRunner({
    clients: new Map([["a", client]]),
    tokens: new Map([["a", { id: "a", name: "队长-101" }]]),
    sleep: async () => {},
  });
  runner.originalFormations.set("a", 1);

  await runner.restoreFormations();

  assert.equal(currentFormation, 1);
  assert.equal(calls.includes("disconnect"), true);
  assert.equal(calls.includes("connect"), true);
  assert.deepEqual(
    calls
      .filter((entry) => typeof entry === "object")
      .map((entry) => entry.cmd),
    ["presetteam_getinfo", "presetteam_saveteam", "presetteam_getinfo"],
  );
});

test("formation restore skips writes when the preset is already correct", async () => {
  const calls = [];
  const client = {
    connected: true,
    disconnect() {
      calls.push("disconnect");
      this.connected = false;
    },
    async connect() {
      calls.push("connect");
      this.connected = true;
    },
    async sendWithPromise(cmd) {
      calls.push(cmd);
      return { presetTeamInfo: { useTeamId: 1 } };
    },
  };
  const runner = new NightmareRunner({
    clients: new Map([["a", client]]),
    tokens: new Map([["a", { id: "a", name: "队长-101" }]]),
    sleep: async () => {},
  });
  runner.originalFormations.set("a", 1);

  await runner.restoreFormations();

  assert.deepEqual(calls, ["disconnect", "connect", "presetteam_getinfo"]);
});

test("formation restore prefers the configured arena formation over the previous preset", async () => {
  const calls = [];
  let currentFormation = 2;
  const client = {
    connected: true,
    disconnect() {
      calls.push("disconnect");
      this.connected = false;
    },
    async connect() {
      calls.push("connect");
      this.connected = true;
    },
    async sendWithPromise(cmd, params) {
      calls.push({ cmd, params });
      if (cmd === "presetteam_getinfo") {
        return { presetTeamInfo: { useTeamId: currentFormation } };
      }
      if (cmd === "presetteam_saveteam") {
        currentFormation = params.teamId;
      }
      return {};
    },
  };
  const runner = new NightmareRunner({
    clients: new Map([["a", client]]),
    tokens: new Map([["a", { id: "a", name: "主力-101" }]]),
    arenaFormations: { a: 1 },
    sleep: async () => {},
  });
  runner.originalFormations.set("a", 2);

  await runner.restoreFormations();

  assert.equal(currentFormation, 1);
});

test("arena formation defaults to 1 when an account has no settings", () => {
  assert.equal(getArenaFormation({ id: "a" }), 1);
  assert.equal(
    getArenaFormation({ id: "b", daily_settings: { arenaFormation: 4 } }),
    4,
  );
  assert.deepEqual(
    getArenaFormationMap([
      { id: "a" },
      { id: "b", daily_settings: { arenaFormation: 3 } },
    ]),
    { a: 1, b: 3 },
  );
});

test("preset formations are not restored when team disband cannot be confirmed", async () => {
  const runner = new NightmareRunner({
    clients: new Map(),
    tokens: new Map(),
    sleep: async () => {},
    now: () => new Date("2026-11-23T02:00:00.000Z"),
  });
  runner.attachRoomListeners = () => {};
  runner.dispose = () => {};
  runner.initializeRoleIds = async () => {};
  runner.prepareMembers = async () => {
    runner.teamId = "match-team-1";
    runner.activeTokenIds = ["a", "b"];
    return { teamId: runner.teamId, activeTokenIds: ["a", "b"] };
  };
  runner.openRoom = async () => {
    runner.roomId = "room-1";
  };
  runner.runLayer = async () => true;
  runner.dismissChallenge = async () => {
    throw new Error("队伍仍在");
  };
  let restored = 0;
  runner.restoreFormations = async () => {
    restored += 1;
  };

  await assert.rejects(
    runner.runChallenge(team({ maxAttempts: 1 }), {
      state: { taskId: "task-a" },
    }),
    /队伍仍在/,
  );
  assert.equal(restored, 0);
});

test("charm task skips a layer when love is insufficient without buying", async () => {
  const calls = [];
  const client = {
    async sendWithPromise(cmd) {
      calls.push(cmd);
      if (cmd === "role_getroleinfo") {
        return { role: { roleId: 101, serverId: 9 } };
      }
      if (cmd === "nightmare_getroleinfo") {
        return { nightMareData: { love: 0, charmData: {} } };
      }
      if (cmd === "nightmare_getcharm") {
        return {
          charmLeftNumMap: { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10 },
        };
      }
      throw new Error("buyCharm must not be called");
    },
  };
  const result = await runCharmPurchaseForClient({
    client,
    token: { id: "a", name: "主力-101" },
    charmSettings: {
      targets: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 },
      pollDurationMs: 2000,
    },
    sleep: async () => {},
    now: () => 1,
  });
  assert.equal(result.status, "warning");
  assert.equal(calls.includes("nightmare_buycharm"), false);
  assert.equal(result.skipped.length, 6);
});

test("charm task stops immediately when shop stock is zero", async () => {
  let sleepCalls = 0;
  const buys = [];
  const client = {
    async sendWithPromise(cmd, params) {
      if (cmd === "role_getroleinfo") {
        return { role: { roleId: 101, serverId: 9 } };
      }
      if (cmd === "nightmare_getroleinfo") {
        return { nightMareData: { love: 1000, charmData: {} } };
      }
      if (cmd === "nightmare_getcharm") {
        return {
          charmLeftNumMap: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
        };
      }
      if (cmd === "nightmare_buycharm") {
        buys.push(params);
        return {};
      }
      return {};
    },
  };
  const result = await runCharmPurchaseForClient({
    client,
    token: { id: "a", name: "主力-101" },
    sleep: async () => {
      sleepCalls += 1;
    },
    now: () => 1,
  });
  assert.equal(buys.length, 0);
  assert.equal(sleepCalls, 0);
  assert.equal(result.status, "warning");
  assert.ok(result.missing.every((entry) => entry.reason === "商店库存不足"));
});

test("starting an existing ten-hall team does not switch preset formations again", async () => {
  const calls = [];
  const leaderClient = {
    async sendWithPromise(cmd, params) {
      calls.push({ cmd, params });
      if (cmd === "matchteam_getteaminfo") {
        return {
          teamInfo: {
            teamId: "team-existing",
            fightRoleBase: [
              { roleId: 101, prepared: 0 },
              { roleId: 102, prepared: 1 },
            ],
          },
        };
      }
      return {};
    },
  };
  const runner = new NightmareRunner({
    clients: new Map([
      ["a", leaderClient],
      ["b", { sendWithPromise: async () => ({}) }],
    ]),
    tokens: new Map([
      ["a", { id: "a", name: "A-101" }],
      ["b", { id: "b", name: "B-102" }],
    ]),
    sleep: async () => {},
  });
  runner.roleIds.set("a", 101);
  runner.roleIds.set("b", 102);
  const result = await runner.reuseExistingTeam(
    team({
      members: [
        { tokenId: "a", formation: 1 },
        { tokenId: "b", formation: 2 },
      ],
    }),
    "a",
    leaderClient,
    { teamId: "team-existing" },
  );
  assert.deepEqual(result.activeTokenIds, ["a", "b"]);
  assert.equal(
    calls.some((entry) => entry.cmd === "presetteam_saveteam"),
    false,
  );
});

test("after opening the room both setfighter and fight are sent by the leader", async () => {
  const leaderCalls = [];
  let memberCalls = 0;
  const leaderClient = {
    send(cmd, params) {
      leaderCalls.push({ kind: "send", cmd, params });
    },
    async sendWithPromise(cmd, params) {
      leaderCalls.push({ kind: "promise", cmd, params });
      return {};
    },
  };
  const memberClient = {
    async sendWithPromise() {
      memberCalls += 1;
      return {};
    },
  };
  const runner = new NightmareRunner({
    clients: new Map([
      ["a", leaderClient],
      ["b", memberClient],
    ]),
    tokens: new Map([
      ["a", { id: "a", name: "队长-101" }],
      ["b", { id: "b", name: "队员-102" }],
    ]),
    sleep: async () => {},
  });
  runner.roomId = "room-1";
  runner.roleIds.set("a", 101);
  runner.roleIds.set("b", 102);
  runner.finishFight = async () => ({});
  await runner.runOneFight(
    team({
      leaderTokenId: "a",
      members: [
        { tokenId: "a", formation: 1 },
        { tokenId: "b", formation: 1 },
      ],
    }),
    "b",
    1,
  );
  assert.deepEqual(
    leaderCalls.map((entry) => entry.cmd),
    ["nightmare_setfighter", "nightmare_fight"],
  );
  assert.equal(memberCalls, 0);
});
