const WEEKLY_STORE_ACTIVITY_TYPE = 4;

export const WEEKLY_STORE_PROTOCOLS = Object.freeze([
  {
    label: "招募周",
    activityId: 6,
    goods: Object.freeze({
      activityId: 6,
      goodsIndex: 0,
      buyNum: 1,
    }),
  },
  {
    label: "宝箱周",
    activityId: 7,
    goods: Object.freeze({
      activityId: 7,
      goodsIndex: 0,
      buyNum: 1,
    }),
  },
]);

function collectionValue(collection, key) {
  if (!collection) return undefined;
  if (collection instanceof Map) {
    if (collection.has(key)) return collection.get(key);
    const stringKey = String(key);
    if (collection.has(stringKey)) return collection.get(stringKey);
    const numberKey = Number(key);
    if (Number.isFinite(numberKey) && collection.has(numberKey)) {
      return collection.get(numberKey);
    }
    return undefined;
  }
  return collection[key];
}

function activityRoot(response) {
  if (response?._data?.activity) return response._data.activity;
  if (response?.activity?.activity) return response.activity;
  if (response?.activity) return response.activity;
  return response;
}

function activityList(root) {
  const list = collectionValue(root, "activity");
  if (Array.isArray(list)) return list;
  if (list instanceof Map) return [...list.values()];
  if (list && typeof list === "object") return Object.values(list);
  return [];
}

/**
 * Detect the active weekly activity that has its own limited-time store.
 *
 * Both recruit week and box week use activity type 4, so the activity ID is
 * the stable discriminator. Add the black-market activity ID and goods payload
 * to WEEKLY_STORE_PROTOCOLS after that rotation has been captured.
 */
export function detectWeeklyStoreState(response) {
  const root = activityRoot(response);
  const activities = activityList(root);
  const config = WEEKLY_STORE_PROTOCOLS.find((candidate) =>
    activities.some(
      (activity) => Number(activity?.id) === candidate.activityId,
    ),
  );

  if (!config) {
    return {
      supported: false,
      active: false,
      complete: false,
      label: "",
      goods: null,
    };
  }

  const activity = activities.find(
    (candidate) => Number(candidate?.id) === config.activityId,
  );
  const storeInfo = collectionValue(
    collectionValue(root, "myStoreInfo"),
    config.activityId,
  );
  const goodsState = collectionValue(storeInfo, "complete");
  const complete =
    Number(collectionValue(goodsState, config.goods.goodsIndex) || 0) > 0;

  return {
    supported: true,
    active: Number(activity?.type) === WEEKLY_STORE_ACTIVITY_TYPE,
    complete,
    label: config.label,
    goods: { ...config.goods },
  };
}
