export const DEFAULT_BATCH_SETTINGS = Object.freeze({
  dreamPurchaseList: [
    "1-5",
    "1-6",
    "2-6",
    "2-7",
    "3-5",
    "3-6",
    "3-7",
  ],
  blackMarketPurchaseList: [
    { itemId: 2002, discount: 10 },
    { itemId: 2003, discount: 10 },
    { itemId: 2004, discount: 10 },
    { itemId: 1012, discount: 7 },
  ],
  boxCount: 100,
  fishCount: 100,
  recruitCount: 100,
  cdkCodes: "",
  cdkPlatformType: "h5",
  defaultBoxType: 2001,
  defaultFishType: 1,
  targetBoxPoints: 1000,
  receiverId: "",
  password: "",
  weirdTowerMaxClimb: 100,
  giftQuantity: 10,
});

function numberInRange(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function stringValue(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeDreamList(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\s,，;；]+/)
        .filter(Boolean);
  return [
    ...new Set(
      items
        .map((item) => String(item).trim())
        .filter((item) => /^[1-3]-\d+$/.test(item)),
    ),
  ];
}

function normalizeBlackMarketList(value) {
  if (!Array.isArray(value)) return null;
  return value
    .map((entry) => {
      const itemId = Number(entry?.itemId);
      if (!Number.isInteger(itemId) || itemId <= 0) return null;
      return {
        itemId,
        discount: numberInRange(entry?.discount, 10, 1, 10),
      };
    })
    .filter(Boolean);
}

/**
 * Normalize the NAS-owned execution settings used by scheduled batch tasks.
 */
export function normalizeBatchSettings(input = {}) {
  const value = input && typeof input === "object" ? input : {};
  const hasDreamList =
    value.dreamPurchaseList !== undefined &&
    value.dreamPurchaseList !== null;
  const hasBlackMarketList = Array.isArray(value.blackMarketPurchaseList);
  const dreamPurchaseList = normalizeDreamList(value.dreamPurchaseList);
  const blackMarketPurchaseList = normalizeBlackMarketList(
    value.blackMarketPurchaseList,
  );
  return {
    dreamPurchaseList: hasDreamList
      ? dreamPurchaseList
      : [...DEFAULT_BATCH_SETTINGS.dreamPurchaseList],
    blackMarketPurchaseList: hasBlackMarketList
      ? blackMarketPurchaseList
      : DEFAULT_BATCH_SETTINGS.blackMarketPurchaseList.map((entry) => ({
          ...entry,
        })),
    boxCount: numberInRange(value.boxCount, 100, 1, 10_000),
    fishCount: numberInRange(value.fishCount, 100, 1, 10_000),
    recruitCount: numberInRange(value.recruitCount, 100, 1, 10_000),
    cdkCodes: stringValue(value.cdkCodes, ""),
    cdkPlatformType: ["h5", "wx"].includes(value.cdkPlatformType)
      ? value.cdkPlatformType
      : "h5",
    defaultBoxType: numberInRange(value.defaultBoxType, 2001, 2001, 2004),
    defaultFishType: numberInRange(value.defaultFishType, 1, 1, 2),
    targetBoxPoints: numberInRange(value.targetBoxPoints, 1000, 1, 10_000),
    receiverId: stringValue(value.receiverId, "").trim(),
    password: stringValue(value.password, ""),
    weirdTowerMaxClimb: numberInRange(
      value.weirdTowerMaxClimb,
      100,
      1,
      1000,
    ),
    giftQuantity: numberInRange(value.giftQuantity, 10, 1, 9999),
  };
}

/**
 * Merge NAS global execution settings with task-specific overrides.
 * Task options win for schedule-specific values such as club or recipient IDs.
 */
export function applyBatchSettingsToTask(task, settings) {
  const normalized = normalizeBatchSettings(settings);
  const taskOptions =
    task?.options && typeof task.options === "object" ? task.options : {};
  return {
    ...task,
    options: {
      boxType: normalized.defaultBoxType,
      boxCount: normalized.boxCount,
      fishType: normalized.defaultFishType,
      fishCount: normalized.fishCount,
      recruitCount: normalized.recruitCount,
      targetBoxPoints: normalized.targetBoxPoints,
      redeemCodes: normalized.cdkCodes,
      platformType: normalized.cdkPlatformType,
      blackMarketPurchaseList: normalized.blackMarketPurchaseList,
      dreamPurchaseList: normalized.dreamPurchaseList,
      recipientId: normalized.receiverId,
      securityPassword: normalized.password,
      giftQuantity: normalized.giftQuantity,
      weirdTowerMaxClimb: normalized.weirdTowerMaxClimb,
      ...taskOptions,
    },
  };
}
