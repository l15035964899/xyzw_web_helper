export const NIGHTMARE_LAYERS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
export const NIGHTMARE_CHARM_LAYERS = Object.freeze([1, 2, 3, 4, 5, 6]);
export const DEFAULT_CHARM_PRIORITY = Object.freeze([2, 5, 1, 3, 4, 6]);
export const DEFAULT_CHARM_TARGETS = Object.freeze({
  1: 1,
  2: 1,
  3: 1,
  4: 1,
  5: 1,
  6: 1,
});

export const NIGHTMARE_RESTORE_LIMITS = Object.freeze({
  1: 1,
  2: 1,
  3: 1,
  4: 2,
  5: 2,
  6: 2,
  7: 3,
  8: 3,
});

function asString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function asBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === "1" || value === "true";
}

function integerInRange(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(asString).filter(Boolean))];
}

function normalizeTeamMembers(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const members = [];
  for (const entry of value) {
    const tokenId = asString(entry?.tokenId ?? entry?.token_id ?? entry?.id);
    if (!tokenId || seen.has(tokenId)) continue;
    seen.add(tokenId);
    members.push({
      tokenId,
      formation: integerInRange(
        entry?.formation ?? entry?.presetTeamId,
        1,
        1,
        6,
      ),
    });
  }
  return members.slice(0, 5);
}

function normalizeStages(value, memberIds) {
  const source = value && typeof value === "object" ? value : {};
  return NIGHTMARE_LAYERS.map((layer) => {
    const raw = Array.isArray(source)
      ? source.find((entry) => Number(entry?.layer ?? entry?.level) === layer)
          ?.order
      : source[layer]?.order ?? source[layer];
    return {
      layer,
      order: uniqueStrings(raw).filter((tokenId) => memberIds.has(tokenId)),
    };
  });
}

function normalizeTeam(input = {}, index = 0) {
  const members = normalizeTeamMembers(input.members);
  const memberIds = new Set(members.map((entry) => entry.tokenId));
  const legacyMaxAttempts = integerInRange(input.maxAttempts, 3, 1, 3);
  const maxRetries = integerInRange(
    input.maxRetries,
    legacyMaxAttempts - 1,
    0,
    2,
  );
  const leaderTokenId = asString(
    input.leaderTokenId ?? input.leader_token_id ?? input.leaderId,
  );
  const mainTokenId = asString(
    input.mainTokenId ?? input.main_token_id ?? input.mainId,
  );
  return {
    id: asString(input.id) || `nightmare-team-${index + 1}`,
    name: asString(input.name) || `十殿队伍${index + 1}`,
    enabled: asBoolean(input.enabled, true),
    leaderTokenId: memberIds.has(leaderTokenId) ? leaderTokenId : "",
    mainTokenId: memberIds.has(mainTokenId) ? mainTokenId : "",
    members,
    stages: normalizeStages(input.stages, memberIds),
    maxRetries,
    maxAttempts: maxRetries + 1,
    fastMode: asBoolean(input.fastMode, false),
    fastWaitSeconds: integerInRange(input.fastWaitSeconds, 5, 5, 120),
    crossWeek: asBoolean(input.crossWeek, true),
  };
}

function normalizeCharmPriority(value) {
  const requested = uniqueStrings(value)
    .map(Number)
    .filter(
      (layer) =>
        Number.isInteger(layer) &&
        layer >= 1 &&
        layer <= NIGHTMARE_CHARM_LAYERS.length,
    );
  return [
    ...new Set([
      ...requested,
      ...DEFAULT_CHARM_PRIORITY,
      ...NIGHTMARE_CHARM_LAYERS,
    ]),
  ];
}

function normalizeCharmTargets(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    NIGHTMARE_CHARM_LAYERS.map((layer) => [
      layer,
      integerInRange(
        source[layer] ?? source[String(layer)],
        DEFAULT_CHARM_TARGETS[layer],
        0,
        50,
      ),
    ]),
  );
}

export function normalizeNightmareCharmSettings(input = {}) {
  return {
    priority: normalizeCharmPriority(input.priority),
    targets: normalizeCharmTargets(input.targets),
    pollIntervalMs: integerInRange(input.pollIntervalMs, 2000, 2000, 30_000),
    pollDurationMs: integerInRange(
      input.pollDurationMs,
      120_000,
      2000,
      600_000,
    ),
  };
}

export function normalizeNightmareSettings(input = {}) {
  const teams = Array.isArray(input?.teams)
    ? input.teams.map((team, index) => normalizeTeam(team, index)).slice(0, 3)
    : [];
  return {
    version: 1,
    teams,
    charm: normalizeNightmareCharmSettings(input?.charm),
  };
}

export function createEmptyNightmareTeam(index = 0) {
  return {
    id: `nightmare-team-${index + 1}`,
    name: `十殿队伍${index + 1}`,
    enabled: true,
    leaderTokenId: "",
    mainTokenId: "",
    members: [
      { tokenId: "", formation: 1 },
      { tokenId: "", formation: 1 },
    ],
    stages: NIGHTMARE_LAYERS.map((layer) => ({ layer, order: [] })),
    maxAttempts: 3,
    maxRetries: 2,
    fastMode: false,
    fastWaitSeconds: 5,
    crossWeek: true,
  };
}

export function getNightmareTeam(settings, teamId) {
  const normalized = normalizeNightmareSettings(settings);
  return (
    normalized.teams.find((team) => team.id === asString(teamId)) ||
    normalized.teams.find((team) => team.enabled) ||
    null
  );
}

export function getNightmareTeamAccountIds(team) {
  return uniqueStrings((team?.members || []).map((entry) => entry.tokenId));
}

export function getNightmareStageOrder(team, layer) {
  return (
    team?.stages?.find((entry) => Number(entry.layer) === Number(layer))
      ?.order || []
  );
}

export function nightmareMemberMatchesRole(member, expectedRoleId) {
  const expected = Number(expectedRoleId);
  if (!Number.isInteger(expected) || expected <= 0) return false;
  const candidates = [
    member?.roleId,
    member?.id,
    member?.roleBase?.roleId,
    member?.roleInfo?.roleId,
  ];
  if (
    candidates.some(
      (value) => Number.isInteger(Number(value)) && Number(value) === expected,
    )
  ) {
    return true;
  }
  return new RegExp(`(?:^|[-_])${expected}$`).test(String(member?.name || ""));
}

export function validateNightmareTeam(team) {
  const errors = [];
  const normalized = normalizeTeam(team);
  const accountIds = getNightmareTeamAccountIds(normalized);
  if (accountIds.length < 2 || accountIds.length > 5) {
    errors.push("队伍人数必须为 2～5 人");
  }
  if (!normalized.leaderTokenId) {
    errors.push("必须从队伍成员中选择队长");
  }
  if (!normalized.mainTokenId) {
    errors.push("必须从队伍成员中选择主力");
  }
  for (const stage of normalized.stages) {
    const order = stage.order;
    if (order.length === 0) {
      errors.push(`第 ${stage.layer} 层至少配置一名出战成员`);
      continue;
    }
    if (new Set(order).size !== order.length) {
      errors.push(`第 ${stage.layer} 层出战成员不能重复`);
    }
    const unknown = order.find((tokenId) => !accountIds.includes(tokenId));
    if (unknown) {
      errors.push(`第 ${stage.layer} 层包含不在队伍中的账号`);
    }
  }
  return { valid: errors.length === 0, errors, team: normalized };
}

export function validateNightmareSettings(settings) {
  const normalized = normalizeNightmareSettings(settings);
  const errors = [];
  const seenAccounts = new Set();
  for (const team of normalized.teams) {
    const result = validateNightmareTeam(team);
    if (!result.valid) {
      errors.push(
        ...result.errors.map((error) => `${team.name || team.id}: ${error}`),
      );
    }
    for (const accountId of getNightmareTeamAccountIds(team)) {
      if (seenAccounts.has(accountId)) {
        errors.push(`账号 ${accountId} 同时出现在多套十殿队伍中`);
      }
      seenAccounts.add(accountId);
    }
  }
  return { valid: errors.length === 0, errors, settings: normalized };
}

export function assertValidNightmareTeam(team) {
  const result = validateNightmareTeam(team);
  if (!result.valid) {
    throw new Error(result.errors.join("；"));
  }
  return result.team;
}
