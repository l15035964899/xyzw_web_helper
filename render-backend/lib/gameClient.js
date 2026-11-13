import WebSocket from "ws";
import { bon, encode, getEnc, parse } from "./bonProtocol.js";

/**
 * XYZW 游戏客户端 - Node.js 简化版
 * 基于 xyzwWebSocket.js 改造，适配 ws + ES Module
 */

// 错误码映射
const errorCodeMap = {
  700010: "任务未达成完成条件",
  1400010: "没有购买月卡",
  12000116: "今日已领取免费奖励",
  3300060: "扫荡条件不满足",
  1300050: "请修改您的采购次数",
  200400: "操作太快",
  2300190: "今天已签到",
  2300370: "俱乐部商品购买数量超出上限",
  400000: "物品不存在",
  400190: "没有可领取的签到奖励",
  1000020: "今天已领取",
  700020: "已领取过",
  400010: "物品不足",
  1500020: "能量不足",
  3500020: "没有可领取的奖励",
  200160: "模块未开启",
  200020: "出了点小问题",
  12400000: "挂机奖励领取过于频繁",
  7500140: "请先输入密码",
  7500100: "密码输入错误",
  7500120: "密码输入错误次数已达上限",
  200760: "界面已变化，请重新登录",
  2300070: "未加入俱乐部",
  2300250: "俱乐部BOSS今日攻打次数已用完",
  3300050: "购买数量超出限制",
  7900023: "已达到使用次数上限",
  4800080: "不在活动时间内或未到报名阶段",
  4800040: "俱乐部没有报名",
  2100010: "活动未开放",
  200750: "战斗版本已失效，请刷新战斗数据后重试",
};

const BATTLE_VERSION_COMMANDS = new Set([
  "fight_startareaarena",
  "fight_startpvp",
  "fight_starttower",
  "fight_startboss",
  "fight_startlegionboss",
  "fight_startdungeon",
  "fight_level",
]);

// 预注册命令模板
const CMD_DEFAULTS = {
  role_getroleinfo: {
    clientVersion: "2.21.2-fa918e1997301834-wx",
    inviteUid: 0,
    platform: "hortor",
    platformExt: "mix",
    scene: "",
  },
  system_claimhangupreward: {},
  system_signinreward: {},
  system_mysharecallback: { isSkipShareCard: true, type: 2 },
  system_claimcdkreward: { key: "", platformType: "h5" },
  task_claimdailyreward: { rewardId: 0 },
  task_claimdailypoint: { taskId: 1 },
  system_getdatabundlever: { isAudit: false },
  system_buygold: { buyNum: 1 },
  system_custom: { key: "", value: 0 },
  tower_getinfo: {},
  tower_claimreward: {},
  evotower_getinfo: {},
  evotower_fight: {},
  evotower_readyfight: {},
  evotower_claimreward: {},
  evotower_claimtask: { taskId: 1 },
  arena_startarea: {},
  arena_getareatarget: { refresh: false },
  arena_getarearank: {},
  item_openbox: { itemId: 2001, number: 10 },
  item_batchclaimboxpointreward: {},
  bottlehelper_start: { bottleType: -1 },
  bottlehelper_claim: {},
  legacy_getinfo: {},
  legacy_claimhangup: {},
  hero_recruit: { byClub: false, recruitNumber: 1, recruitType: 3 },
  study_startgame: {},
  study_answer: {},
  study_claimreward: { rewardId: 1 },
  fight_startlevel: {},
  fight_starttower: {},
  fight_startboss: {},
  fight_startpvp: {},
  fight_startdungeon: {},
  matchteam_getroleteaminfo: {},
  bosstower_getinfo: {},
  bosstower_startboss: {},
  bosstower_startbox: {},
  legion_getinfo: {},
  legion_getinfobyid: { legionId: 0 },
  legion_applyjoin: { legionId: 0 },
  legion_signin: {},
  legion_storebuygoods: {},
  club_getinfo: {},
  club_gettargetteam: { targetId: 0 },
  club_attack: {},
  club_attackmonster: {},
  club_taskclaim: { confId: 1 },
  mail_getlist: { category: [0, 4, 5], lastId: 0, size: 60 },
  mail_claimallattachment: { category: 0 },
  presetteam_getinfo: {},
  presetteam_saveteam: { teamId: 1 },
  artifact_lottery: { lotteryNumber: 1, newFree: true, type: 1 },
  artifact_exchange: {},
  genie_sweep: { genieId: 1 },
  mergebox_getinfo: {},
  mergebox_claimfreeenergy: {},
  mergebox_openbox: {},
  mergebox_automergeitem: { actType: 1 },
  mergebox_mergeitem: { actType: 1 },
  mergebox_claimcostprogress: { actType: 1 },
  mergebox_claimmergeprogress: { actType: 1 },
  discount_claimreward: { discountId: 1 },
  card_claimreward: { cardId: 1 },
  collection_claimfreereward: {},
  bottlehelper_stop: { bottleType: -1 },
  store_getpurchase: {},
  store_setpurchase: { purchaseCnt: 1, purchaseItemList: [] },
  store_purchase: {},
  rank_getroleinfo: {},
  role_commitpassword: { password: "", passwordType: 1 },
  legacy_sendgift: { itemCnt: 0, legacyUIds: [], targetId: 0 },
  legion_getpayloadtask: {},
  legion_claimpayloadtask: { taskId: 1 },
  legion_claimpayloadtaskprogress: { taskGroup: 1 },
  activity_get: {},
  dungeon_selecthero: {},
  dungeon_buymerchant: {},
  towers_getinfo: {},
  towers_start: {},
  towers_fight: {},
  activity_startactegame: { actId: 0 },
  activity_warorderget: {},
  activity_warordertaskclaim: {},
  activity_warorderrewardclaim: {},
  activity_getlotteryinfo: {},
  activity_lottery: { times: 1 },
  activity_claimsignreward: {},
  activity_commonbuygoods: {},
};

// 响应→请求命令映射
const RESP_MAP = {
  role_getroleinforesp: "role_getroleinfo",
  system_claimhanguprewardresp: "system_claimhangupreward",
  system_signinrewardresp: "system_signinreward",
  system_claimcdkrewardresp: "system_claimcdkreward",
  system_getdatabundleverresp: "system_getdatabundlever",
  task_claimdailyrewardresp: "task_claimdailyreward",
  tower_getinforesp: "tower_getinfo",
  tower_claimrewardresp: "tower_claimreward",
  evotowerinforesp: "evotower_getinfo",
  evotower_fightresp: "evotower_fight",
  evotower_claimrewardresp: "evotower_claimreward",
  evotower_claimtaskresp: "evotower_claimtask",
  arena_startarearesp: "arena_startarea",
  arena_getareatargetresp: "arena_getareatarget",
  arena_getarearankresp: "arena_getarearank",
  item_openboxresp: "item_openbox",
  item_batchclaimboxpointrewardresp: "item_batchclaimboxpointreward",
  bottlehelper_claimresp: "bottlehelper_claim",
  bottlehelper_startresp: "bottlehelper_start",
  legacy_getinforesp: "legacy_getinfo",
  legacy_claimhangupresp: "legacy_claimhangup",
  hero_recruitresp: "hero_recruit",
  studyresp: "study_startgame",
  fight_startlevelresp: "fight_startlevel",
  fight_starttowerresp: "fight_starttower",
  fight_startbossresp: "fight_startboss",
  fight_startpvpresp: "fight_startpvp",
  matchteam_getroleteaminforesp: "matchteam_getroleteaminfo",
  bosstower_getinforesp: "bosstower_getinfo",
  bosstower_startbossresp: "bosstower_startboss",
  bosstower_startboxresp: "bosstower_startbox",
  legion_getinforesp: "legion_getinfo",
  legion_signinresp: "legion_signin",
  legion_applyjoinresp: "legion_applyjoin",
  club_getinforesp: "club_getinfo",
  club_gettargetteamresp: "club_gettargetteam",
  club_attackresp: "club_attack",
  club_attackmonsterresp: "club_attackmonster",
  club_taskclaimresp: "club_taskclaim",
  mail_claimallattachmentresp: "mail_claimallattachment",
  presetteam_getinforesp: "presetteam_getinfo",
  presetteam_saveteamresp: "presetteam_saveteam",
  friend_batchresp: "friend_batch",
  fight_startareaarenaresp: "fight_startareaarena",
  task_claimweekrewardresp: "task_claimweekreward",
  artifact_lotteryresp: "artifact_lottery",
  genie_sweepresp: "genie_sweep",
  mergeboxinforesp: "mergebox_getinfo",
  mergebox_claimfreeenergyresp: "mergebox_claimfreeenergy",
  mergebox_openboxresp: "mergebox_openbox",
  mergebox_automergeitemresp: "mergebox_automergeitem",
  mergebox_mergeitemresp: "mergebox_mergeitem",
  mergebox_claimcostprogressresp: "mergebox_claimcostprogress",
  mergebox_claimmergeprogressresp: "mergebox_claimmergeprogress",
  discount_claimrewardresp: "discount_claimreward",
  collection_claimfreerewardresp: "collection_claimfreereward",
  bottlehelper_stopresp: "bottlehelper_stop",
  store_buyresp: "store_purchase",
  store_getpurchaseresp: "store_getpurchase",
  store_setpurchaseresp: "store_setpurchase",
  rank_getroleinforesp: "rank_getroleinfo",
  legacy_sendgiftresp: "legacy_sendgift",
  legion_claimpayloadtaskresp: "legion_claimpayloadtask",
  legion_claimpayloadtaskprogressresp: "legion_claimpayloadtaskprogress",
  activity_getresp: "activity_get",
  towers_getinforesp: "towers_getinfo",
  towers_startresp: "towers_start",
  towers_fightresp: "towers_fight",
  activity_takeegamerewardresp: "activity_startactegame",
  activity_warordergetresp: "activity_warorderget",
  activity_warorderclaimresp: [
    "activity_warorderrewardclaim",
    "activity_warordertaskclaim",
  ],
  activity_getlotteryinforesp: "activity_getlotteryinfo",
  activity_lotteryresp: "activity_lottery",
  activity_rewardresp: "activity_claimsignreward",
  syncrewardresp: [
    "system_buygold",
    "system_signinreward",
    "discount_claimreward",
    "activity_commonbuygoods",
    "artifact_lottery",
    "artifact_exchange",
    "genie_sweep",
    "system_claimcdkreward",
    "dungeon_selecthero",
  ],
  syncresp: [
    "system_mysharecallback",
    "task_claimdailypoint",
    "role_commitpassword",
  ],
  syncpushresp: ["system_mysharecallback"],
};

class GameClient {
  constructor(tokenData, wsUrl) {
    this.token = tokenData;
    this._wsUrl =
      wsUrl ||
      `wss://xxz-xyzw.hortorgames.com/agent?p=${encodeURIComponent(
        JSON.stringify({
          roleToken: tokenData.roleToken,
          roleId: tokenData.roleId,
          sessId: tokenData.sessId,
          connId: tokenData.connId,
          isRestore: tokenData.isRestore,
        }),
      )}&e=x&lang=chinese`;

    this.ws = null;
    this.connected = false;
    this.ack = 0;
    this.seq = 0;
    this.promises = {};
    this.connectionTimer = null;
    this.connectionReject = null;
    this.heartbeatStartTimer = null;
    this.heartbeatTimer = null;
    this.lastMsgAt = Date.now();
    this.serverTime = undefined;
    this.battleVersion = null;
    this.battleVersionPromise = null;
    this._log = (...args) =>
      console.log(
        `[${tokenData.name || "?"}]`,
        new Date().toISOString().slice(11, 19),
        ...args,
      );
  }

  log(...args) {
    this._log(...args);
  }

  connect(timeoutMs = 15000) {
    this.disconnect();
    return new Promise((resolve, reject) => {
      this.log("连接中:", this._wsUrl.split("?")[0]);

      let socket;
      try {
        socket = new WebSocket(this._wsUrl);
      } catch (err) {
        reject(err);
        return;
      }
      this.ws = socket;
      // Each new transport starts a fresh server-side sequence space.
      this.seq = 0;
      this.ack = 0;
      socket.binaryType = "arraybuffer";

      let timer;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.connectionReject === finish) {
          this.connectionReject = null;
          this.connectionTimer = null;
        }
        if (error) reject(error);
        else resolve();
      };
      this.connectionReject = finish;
      if (timeoutMs) {
        timer = setTimeout(() => {
          if (this.ws !== socket || this.connectionTimer !== timer) return;
          finish(new Error("连接超时"));
          this.disconnect();
        }, timeoutMs);
        this.connectionTimer = timer;
      }

      socket.on("open", () => {
        if (this.ws !== socket) return;
        this.connected = true;
        this.log("连接成功");
        finish();
        this._startHeartbeat();
      });

      socket.on("message", (data) => {
        if (this.ws !== socket) return;
        this._handleMessage(data);
      });

      socket.on("close", (code, reason) => {
        finish(new Error("连接在建立前已关闭"));
        if (this.ws !== socket) return;
        this.ws = null;
        this.connected = false;
        this._stopHeartbeat();
        this.log("连接关闭:", code, reason.toString());
        this._rejectPendingRequests();
      });

      socket.on("error", (err) => {
        if (this.ws !== socket) return;
        this.log("错误:", err.message);
        if (!this.connected) finish(err);
      });
    });
  }

  disconnect() {
    const socket = this.ws;
    this.ws = null;
    this.connected = false;
    this.battleVersion = null;
    this.battleVersionPromise = null;
    this._stopHeartbeat();
    clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
    const rejectConnection = this.connectionReject;
    this.connectionReject = null;
    rejectConnection?.(new Error("连接已关闭"));
    this._rejectPendingRequests();
    socket?.close();
  }

  /** Reject the previous transport's requests before its sequence space is reset. */
  _rejectPendingRequests() {
    for (const [id, request] of Object.entries(this.promises)) {
      clearTimeout(request.timer);
      delete this.promises[id];
      request.reject(new Error("连接已关闭"));
    }
  }

  send(cmd, params = {}) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) {
      this.log("未连接，无法发送:", cmd);
      return;
    }
    const assignedSeq = cmd === "heart_beat" ? 0 : this.seq + 1;
    const defaultBody = CMD_DEFAULTS[cmd] || {};
    const mergedParams = { ...defaultBody, ...params };
    const rawMsg = {
      cmd,
      ack: this.ack,
      seq: assignedSeq,
      time: Date.now(),
      body: bon.encode(mergedParams),
    };
    const encoded = encode(rawMsg, getEnc("x"));
    this.ws.send(encoded);
    // Unsent commands must not create sequence gaps rejected by the server.
    if (cmd !== "heart_beat") this.seq = assignedSeq;
    this.log("发送:", cmd, "seq:", assignedSeq);
    return assignedSeq;
  }

  /**
   * Send a command and wait for its response, releasing pending state on failure.
   * @param {string} cmd Protocol command name.
   * @param {object} params Command parameters merged with protocol defaults.
   * @param {number} timeoutMs Maximum response wait in milliseconds.
   * @returns {Promise<object>} Decoded server response.
   */
  async sendWithPromise(cmd, params = {}, timeoutMs = 8000) {
    let requestParams = params;
    if (BATTLE_VERSION_COMMANDS.has(cmd)) {
      const battleVersion =
        params?.battleVersion == null
          ? await this.ensureBattleVersion()
          : params.battleVersion;
      requestParams = { battleVersion, ...params };
    }
    return this._sendWithPromise(cmd, requestParams, timeoutMs);
  }

  async ensureBattleVersion() {
    if (this.battleVersion != null) return this.battleVersion;
    if (!this.battleVersionPromise) {
      const pending = this._fetchBattleVersion();
      const tracked = pending.finally(() => {
        if (this.battleVersionPromise === tracked) {
          this.battleVersionPromise = null;
        }
      });
      this.battleVersionPromise = tracked;
    }
    return this.battleVersionPromise;
  }

  async _fetchBattleVersion() {
    const response = await this._sendWithPromise("fight_startlevel", {}, 8000);
    const version = response?.battleData?.version;
    if (version === undefined || version === null) {
      throw new Error(
        "获取战斗版本失败: fight_startlevel 未返回 battleData.version",
      );
    }
    this.battleVersion = version;
    this.log("获取战斗版本:", version);
    return version;
  }

  _sendWithPromise(cmd, params = {}, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) {
        return reject(new Error("未连接"));
      }
      const requestSeq = this.seq + 1;
      const timer = setTimeout(() => {
        delete this.promises[requestSeq];
        reject(new Error(`请求超时: ${cmd} (${timeoutMs}ms)`));
      }, timeoutMs);
      this.promises[requestSeq] = { resolve, reject, originalCmd: cmd, timer };
      try {
        const defaultBody = CMD_DEFAULTS[cmd] || {};
        const mergedParams = { ...defaultBody, ...params };
        const rawMsg = {
          cmd,
          ack: this.ack,
          seq: requestSeq,
          time: Date.now(),
          body: bon.encode(mergedParams),
        };
        const encoded = encode(rawMsg, getEnc("x"));
        this.ws.send(encoded);
        this.seq = requestSeq;
        this.log("发送并等待:", cmd, "seq:", requestSeq);
      } catch (error) {
        clearTimeout(timer);
        delete this.promises[requestSeq];
        reject(error);
      }
    });
  }

  async executeBatch(commands, delayMs = 500) {
    const results = [];
    for (const { cmd, params, timeout } of commands) {
      try {
        const r = await this.sendWithPromise(cmd, params, timeout || 8000);
        results.push({ cmd, success: true, data: r });
        this.log("成功:", cmd);
      } catch (err) {
        results.push({ cmd, success: false, error: err.message });
        this.log("失败:", cmd, err.message);
      }
      if (delayMs > 0) await sleep(delayMs);
    }
    return results;
  }

  // ===== 便捷任务封装 =====
  async signIn() {
    return this.sendWithPromise("system_signinreward");
  }
  async claimHangUp() {
    return this.sendWithPromise("system_claimhangupreward");
  }
  async getRoleInfo() {
    return this.sendWithPromise("role_getroleinfo");
  }
  async getTowerInfo() {
    return this.sendWithPromise("tower_getinfo");
  }
  async claimTowerReward() {
    return this.sendWithPromise("tower_claimreward");
  }
  async sendAndWait(cmd, params = {}) {
    return this.sendWithPromise(cmd, params);
  }

  _handleMessage(data) {
    this.lastMsgAt = Date.now();
    let protoMsg;
    try {
      protoMsg = parse(data, getEnc("auto"));
    } catch (err) {
      this.log("解析消息失败:", err.message);
      return;
    }

    const msg = protoMsg._raw;
    if (!msg) return;
    if (Number.isFinite(msg.time)) this.serverTime = msg.time;
    if (typeof msg.seq === "number" && msg.seq >= 0) this.ack = msg.seq;

    const respKey = msg.resp !== undefined ? msg.resp : msg.cmd;
    const respCmdKey = respKey?.toLowerCase?.() || respKey;

    if (msg.resp !== undefined && this.promises[msg.resp]) {
      const p = this.promises[msg.resp];
      clearTimeout(p.timer);
      delete this.promises[msg.resp];
      if (msg.code === 0 || msg.code === undefined) {
        p.resolve(protoMsg.rawData || msg);
      } else {
        p.reject(
          new Error(
            `[${msg.code}] ${errorCodeMap[msg.code] || msg.hint || "未知错误"}`,
          ),
        );
      }
      return;
    }

    let requestCmd = RESP_MAP[respCmdKey];
    if (!requestCmd) return;
    if (typeof requestCmd === "string") requestCmd = [requestCmd];

    for (const [id, p] of Object.entries(this.promises)) {
      if (requestCmd.includes(p.originalCmd)) {
        clearTimeout(p.timer);
        delete this.promises[id];
        if (msg.code === 0 || msg.code === undefined) {
          p.resolve(protoMsg.rawData || msg);
        } else {
          p.reject(
            new Error(
              `[${msg.code}] ${errorCodeMap[msg.code] || msg.hint || "未知错误"}`,
            ),
          );
        }
        break;
      }
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    const socket = this.ws;
    const startTimer = setTimeout(() => {
      if (this.heartbeatStartTimer !== startTimer) return;
      this.heartbeatStartTimer = null;
      if (this.ws === socket && this.connected) this._sendHeartbeat();
    }, 3000);
    this.heartbeatStartTimer = startTimer;
    const heartbeatTimer = setInterval(() => {
      if (
        this.heartbeatTimer === heartbeatTimer &&
        this.ws === socket &&
        this.connected
      ) {
        this._sendHeartbeat();
      }
    }, 5000);
    this.heartbeatTimer = heartbeatTimer;
  }

  _stopHeartbeat() {
    clearTimeout(this.heartbeatStartTimer);
    this.heartbeatStartTimer = null;
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _sendHeartbeat() {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      const rawMsg = {
        cmd: "_sys/ack",
        ack: this.ack,
        seq: 0,
        time: Date.now(),
        body: undefined,
      };
      const encoded = encode(rawMsg, getEnc("x"));
      this.ws.send(encoded);
    } catch (e) {
      /* ignore */
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export { GameClient };
