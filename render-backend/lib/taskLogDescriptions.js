const TASK_TYPE_LABELS = {
  signIn: "签到",
  claimHangup: "领取挂机奖励",
  claimDaily: "领取日常奖励",
  claimDailyPoint: "领取每日积分",
  climbTower: "爬塔领奖励",
  climbWeirdTower: "怪异塔",
  arenaFight: "竞技场",
  claimMail: "领取邮件附件",
  legacyHangup: "功法挂机",
  batchLegacyClaim: "领取功法残卷",
  heroRecruit: "武将招募",
  studyGame: "学习问答",
  genieSweep: "灯神",
  openBox: "开箱",
  legionSignIn: "军团签到",
  bossTower: "咸王宝库",
  mergeBox: "合并魔盒",
  resetBottles: "重置罐子",
  batchlingguanzi: "领取盐罐",
  store_purchase: "黑市采购",
  collection_claimfreereward: "珍宝阁免费领取",
  batchXuanwuBlessing: "玄武赐福",
  dailyBundle: "一键日常",
  system_signinreward: "执行签到",
  system_claimhangupreward: "领取挂机奖励",
  task_claimdailyreward: "领取日常奖励",
  task_claimdailypoint: "领取每日积分",
  tower_getinfo: "读取爬塔信息",
  tower_claimreward: "领取爬塔奖励",
  evotower_getinfo: "读取怪异塔信息",
  evotower_claimreward: "领取怪异塔奖励",
  arena_startarea: "进入竞技场",
  arena_getareatarget: "读取竞技场对手",
  arena_getarearank: "读取竞技场排名",
  mail_getlist: "读取邮件列表",
  mail_claimallattachment: "领取邮件附件",
  legacy_getinfo: "读取功法挂机状态",
  legacy_beginhangup: "开始收集功法残卷",
  legacy_claimhangup: "领取功法挂机奖励",
  hero_recruit: "武将招募",
  study_startgame: "开始学习问答",
  genie_sweep: "执行灯神扫荡",
  item_openbox: "开启宝箱",
  legion_getinfo: "读取军团信息",
  legion_signin: "军团签到",
  bosstower_getinfo: "读取咸王宝库信息",
  bosstower_startboss: "挑战咸王宝库",
  bosstower_startbox: "领取咸王宝箱",
  mergebox_getinfo: "读取魔盒信息",
  mergebox_claimfreeenergy: "领取魔盒免费能量",
  mergebox_openbox: "合并魔盒",
  bottlehelper_start: "启动盐罐计时",
  bottlehelper_stop: "停止盐罐计时",
  bottlehelper_claim: "领取盐罐奖励",
  role_getroleinfo: "读取角色信息",
  presetteam_getinfo: "读取阵容信息",
  presetteam_saveteam: "切换阵容",
  dailyRunner: "日常任务检查",
  taskStarted: "定时任务开始",
  taskCompleted: "定时任务完成",
  maintenanceDeferred: "维护避让",
  accountRetry: "失败账号重试",
  startBatch: "日常任务",
  claimHangUpRewards: "领取挂机并加钟",
  batchAddHangUpTime: "一键加钟",
  batchStudy: "一键答题",
  batchOpenBox: "批量开箱",
  batchOpenBoxByPoints: "按积分开箱",
  batchClaimBoxPointReward: "领取宝箱积分",
  batchFish: "批量钓鱼",
  batchRecruit: "批量招募",
  batchRedeemCodes: "使用兑换码",
  batchbaoku13: "宝库前3层",
  batchbaoku45: "宝库4,5层",
  batchmengjing: "咸王梦境",
  batchclubsign: "俱乐部签到",
  batchCampChallenge: "营地挑战",
  batchCampChallengePet: "营地宠物挑战",
  batchCampClaimTasks: "营地任务奖励",
  batchApplyLegion: "申请俱乐部",
  batcharenafight: "竞技场战斗3次",
  batchArenaClearTickets: "竞技场清票",
  arenaClearTickets: "竞技场清票",
  arenaRestoreFormation: "恢复竞技场阵容",
  batchTopUpFish: "钓鱼补齐",
  batchTopUpArena: "竞技场补齐",
  batchClaimFreeEnergy: "怪异塔免费道具",
  skinChallenge: "换皮闯关",
  legion_storebuygoods: "购买四圣碎片",
  store_syncpurchaseconfig: "同步黑市采购清单",
  batchLegacyGiftSendEnhanced: "赠送功法残卷",
  batchUseItems: "使用怪异塔道具",
  batchMergeItems: "怪异塔合成",
  batchUseAndMergeItems: "怪异塔领取+使用+合成",
  batchClaimPeachTasks: "领取蟠桃园任务",
  batchGenieSweep: "灯神扫荡",
  batchBuyDreamItems: "购买梦境商品",
  nightmareChallenge: "自动十殿",
  nightmareSequence: "十殿序列",
  nightmareSequenceTeam: "十殿序列队伍",
  nightmareSequenceWait: "十殿期间等待",
  nightmareCrossWeek: "十殿跨周",
  nightmareRestore: "恢复竞技场阵容",
  nightmareGateReleased: "解除十殿等待",
  nightmareCharmPurchase: "抢十殿符咒",
  nightmare_getroleinfo: "读取十殿角色状态",
  nightmare_getroominfo: "读取十殿房间状态",
  nightmare_setfighter: "指定十殿出战成员",
  nightmare_fight: "十殿挑战",
  nightmare_leadercomplete: "结束十殿动画",
  nightmare_restore: "恢复十殿成员",
  nightmare_getcharm: "查询十殿符咒库存",
  nightmare_buycharm: "购买十殿符咒",
  matchteam_create: "创建十殿队伍",
  matchteam_join: "加入十殿队伍",
  matchteam_memberprepare: "准备十殿队伍",
  matchteam_openteam: "进入十殿挑战",
  fight_startlevel: "读取战斗版本",
  evotower_readyfight: "准备怪异塔战斗",
  evotower_fight: "怪异塔战斗",
  evotower_claimtask: "领取怪异塔任务奖励",
  item_batchclaimboxpointreward: "领取宝箱积分",
  artifact_exchange: "领取钓鱼累计奖励",
  system_claimcdkreward: "使用兑换码",
  dungeon_selecthero: "选择梦境阵容",
  dungeon_buymerchant: "购买梦境商品",
  legion_applyjoin: "申请加入俱乐部",
  legion_getinfobyid: "查询俱乐部",
  legion_getpayloadtask: "读取蟠桃园任务",
  legion_claimpayloadtask: "领取蟠桃园任务",
  legion_claimpayloadtaskprogress: "领取蟠桃园积分奖励",
  store_getpurchase: "读取黑市采购清单",
  store_setpurchase: "写入黑市采购清单",
  rank_getroleinfo: "查询接收者信息",
  role_commitpassword: "验证游戏安全密码",
  legacy_sendgift: "赠送功法残卷",
  mergebox_automergeitem: "怪异塔自动合成",
  mergebox_mergeitem: "怪异塔合成",
  mergebox_claimcostprogress: "领取怪异塔累计奖励",
  mergebox_claimmergeprogress: "领取怪异塔合成奖励",
  towers_getinfo: "读取换皮闯关",
  towers_start: "开始换皮闯关",
  towers_fight: "换皮闯关战斗",
};

const ERROR_HINTS = {
  700010: "任务尚未达到完成条件",
  1400010: "没有购买月卡",
  12000116: "今日已领取免费奖励",
  3300060: "扫荡条件不满足",
  1300050: "采购次数需要调整",
  200400: "操作过于频繁",
  2300190: "今天已经签到",
  2300370: "俱乐部商品购买数量超出上限",
  400000: "物品不存在",
  400190: "没有可领取的签到奖励",
  1000020: "今天已经领取",
  700020: "已经领取过",
  800040: "没有可领取的挂机奖励",
  400010: "物品数量不足",
  1500020: "能量不足",
  3500020: "没有可领取的奖励",
  200160: "对应模块尚未开启",
  200020: "游戏服务器返回了一个可重试的临时问题",
  200330: "存在未完成的挑战，需要先手动处理",
  12200020: "怪异塔章节奖励尚未领取",
  12400000: "挂机奖励领取过于频繁",
  12400160: "请先开始功法残卷收集",
  7500140: "请先输入密码",
  7500100: "密码输入错误",
  7500120: "密码错误次数已达到上限",
  200760: "游戏界面状态已变化，请重新登录",
  2300070: "尚未加入俱乐部",
  2300250: "俱乐部首领今日攻打次数已用完",
  3300050: "购买数量超出限制",
  7900023: "已经达到使用次数上限",
  4800080: "不在活动时间内或尚未到报名阶段",
  4800040: "俱乐部没有报名",
  2100010: "活动尚未开放",
  200750: "战斗版本已失效，请刷新战斗数据后重试",
  1100010: "本周限购奖励已领取",
  7100020: "已经加入队伍",
  7800320: "不在队伍中",
  200110: "队伍名称包含非法字符",
};

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text && text !== "-" && text.toUpperCase() !== "OK" ? text : "";
}

export function formatTaskTypeLabel(taskType) {
  const raw = String(taskType || "").trim();
  if (!raw) return "未知操作";
  return raw
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean)
    .map((key) => TASK_TYPE_LABELS[key] || key)
    .join("、");
}

export function explainLogError(message) {
  const raw = cleanText(message);
  if (!raw) return "游戏服务器未返回具体原因";
  if (/^执行失败[:：]/.test(raw)) return raw;
  if (!raw.startsWith("[")) return raw;
  const close = raw.indexOf("]");
  if (close <= 1) return raw;
  const codeText = raw.slice(1, close);
  if (!/^\d+$/.test(codeText)) return raw;
  const code = Number(codeText);
  const fallback = cleanText(raw.slice(close + 1));
  const hint = ERROR_HINTS[code] || fallback || "游戏服务器未返回具体原因";
  return `${hint}（错误码 ${code}）`;
}

export function formatTaskLogMessage({ taskType, status, message }) {
  const rawType = String(taskType || "unknown");
  const label = formatTaskTypeLabel(rawType);
  const detail = cleanText(message);
  if (/^执行(?:成功|失败)[:：]/.test(detail)) return detail;

  if (status === "success") {
    return detail
      ? `执行成功：${label}（${rawType}）；${detail}`
      : `执行成功：${label}（${rawType}）`;
  }
  if (status === "error") {
    return `执行失败：${label}（${rawType}）；${explainLogError(detail)}`;
  }
  return detail || `${label}（${rawType}）`;
}
