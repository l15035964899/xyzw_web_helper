export const NIGHTMARE_LAYERS = [1, 2, 3, 4, 5, 6, 7, 8];

export const defaultNightmareCharmSettings = {
  priority: [2, 5, 1, 3, 4, 6],
  targets: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 },
  pollIntervalMs: 2000,
  pollDurationMs: 120000,
};

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

export const defaultNightmareSettings = {
  version: 1,
  teams: [createEmptyNightmareTeam(0)],
  charm: defaultNightmareCharmSettings,
};

export function cloneNightmareSettings(settings) {
  const source =
    settings && typeof settings === "object"
      ? settings
      : defaultNightmareSettings;
  return JSON.parse(JSON.stringify(source));
}

function teamMemberIds(team) {
  return new Set(
    (team?.members || [])
      .map((entry) => String(entry?.tokenId || ""))
      .filter(Boolean),
  );
}

function memberOverlap(left, right) {
  const leftIds = teamMemberIds(left);
  return (right?.members || []).some((entry) => {
    const tokenId = String(entry?.tokenId || "");
    return tokenId && leftIds.has(tokenId);
  });
}

export function buildNightmareSequencePlan(teams = []) {
  const activeCrossWeekTeams = [];
  let hasEnabledTeam = false;
  return teams.map((team, index) => {
    const forcedAnchor = team.enabled && !hasEnabledTeam;
    if (forcedAnchor) {
      hasEnabledTeam = true;
    }
    const conflictTeamIds = forcedAnchor
      ? []
      : activeCrossWeekTeams
          .filter((activeTeam) => memberOverlap(activeTeam, team))
          .map((activeTeam) => activeTeam.id);
    const crossWeekLocked = conflictTeamIds.length > 0;
    const crossWeek = forcedAnchor
      ? true
      : crossWeekLocked
        ? false
        : Boolean(team.crossWeek);
    if (team.enabled && crossWeek) activeCrossWeekTeams.push(team);
    return {
      index,
      teamId: team.id,
      teamName: team.name,
      enabled: team.enabled,
      crossWeek,
      crossWeekLocked: forcedAnchor || crossWeekLocked,
      conflictTeamIds,
    };
  });
}

export function sanitizeNightmareSettings(settings) {
  const value = cloneNightmareSettings(settings);
  value.teams = Array.isArray(value.teams) ? value.teams.slice(0, 3) : [];
  for (const team of value.teams) {
    team.enabled = team.enabled !== false;
    const seenInTeam = new Set();
    team.members = (team.members || []).filter((member) => {
      const tokenId = String(member?.tokenId || "");
      if (!tokenId || seenInTeam.has(tokenId)) {
        return false;
      }
      seenInTeam.add(tokenId);
      member.tokenId = tokenId;
      member.formation = Math.min(
        6,
        Math.max(1, Number(member.formation) || 1),
      );
      return true;
    });
    const memberIds = new Set(team.members.map((entry) => entry.tokenId));
    if (!memberIds.has(String(team.leaderTokenId || ""))) {
      team.leaderTokenId = "";
    }
    if (!memberIds.has(String(team.mainTokenId || ""))) {
      team.mainTokenId = "";
    }
    team.stages = NIGHTMARE_LAYERS.map((layer) => {
      const existing = (team.stages || []).find(
        (entry) => Number(entry.layer) === layer,
      );
      return {
        layer,
        order: [
          ...new Set(
            (existing?.order || [])
              .map(String)
              .filter((tokenId) => memberIds.has(tokenId)),
          ),
        ],
      };
    });
    team.maxRetries = Math.min(
      2,
      Math.max(
        0,
        Number(
          team.maxRetries ?? Math.max(0, Number(team.maxAttempts || 1) - 1),
        ) || 0,
      ),
    );
    team.maxAttempts = team.maxRetries + 1;
  }
  const plan = buildNightmareSequencePlan(value.teams);
  value.teams.forEach((team, index) => {
    team.crossWeek = plan[index].crossWeek;
  });
  return value;
}

export function validateNightmareTeamForUi(team) {
  const errors = [];
  const members = (team?.members || []).filter((entry) => entry.tokenId);
  const ids = new Set(members.map((entry) => String(entry.tokenId)));
  if (members.length < 2 || members.length > 5) {
    errors.push("队伍人数必须为 2～5 人");
  }
  if (!ids.has(String(team?.leaderTokenId || ""))) {
    errors.push("请从队伍成员中选择队长");
  }
  if (!ids.has(String(team?.mainTokenId || ""))) {
    errors.push("请从队伍成员中选择主力");
  }
  for (const stage of team?.stages || []) {
    const order = (stage.order || []).filter(Boolean);
    if (order.length === 0) {
      errors.push(`第 ${stage.layer} 层至少选择一名出战成员`);
    }
    if (new Set(order.map(String)).size !== order.length) {
      errors.push(`第 ${stage.layer} 层成员不能重复`);
    }
    if (order.some((tokenId) => !ids.has(String(tokenId)))) {
      errors.push(`第 ${stage.layer} 层包含不在队伍中的账号`);
    }
  }
  return errors;
}

export function validateNightmareSettingsForUi(settings) {
  const teams = settings?.teams || [];
  if (teams.length === 0) return ["至少创建一套十殿队伍"];
  const errors = [];
  for (const team of teams) {
    errors.push(
      ...validateNightmareTeamForUi(team).map(
        (message) => `${team.name || team.id}: ${message}`,
      ),
    );
  }
  return errors;
}
