function normalizeId(value) {
  return value === null || value === undefined ? "" : String(value);
}

export function getScheduleTokenValue(token, tokenIdMap = {}) {
  return (
    tokenIdMap[token?.id] ||
    token?.serverAccountId ||
    token?.nasId ||
    token?.id ||
    null
  );
}

export function mapLocalTokenIdsToScheduleIds(
  localTokenIds = [],
  tokens = [],
  tokenIdMap = {},
) {
  const requested = new Set(localTokenIds.map(normalizeId).filter(Boolean));
  const result = [];
  const seen = new Set();

  for (const token of tokens) {
    if (!requested.has(normalizeId(token?.id))) continue;
    const scheduleId = getScheduleTokenValue(token, tokenIdMap);
    const key = normalizeId(scheduleId);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(scheduleId);
  }

  return result;
}

export function hasSelectedScheduleTokens(
  groupTokenIds = [],
  selectedTokenIds = [],
) {
  const groupIds = groupTokenIds.map(normalizeId).filter(Boolean);
  if (groupIds.length === 0) return false;
  const selected = new Set(selectedTokenIds.map(normalizeId));
  return groupIds.every((id) => selected.has(id));
}
