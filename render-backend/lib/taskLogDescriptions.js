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
  400010: "物品数量不足",
  1500020: "能量不足",
  3500020: "没有可领取的奖励",
  200160: "对应模块尚未开启",
  200020: "游戏服务器返回了一个可重试的临时问题",
  12400000: "挂机奖励领取过于频繁",
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
  800040: "游戏服务器未返回具体原因，请稍后重试并确认该操作状态",
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
