import { requestBatchServer } from "./batchSchedules";

export function saveNightmareSettings(nightmare) {
  return requestBatchServer("/api/nightmare/settings", {
    method: "PATCH",
    body: { nightmare },
  });
}

export function loadNightmareStatus() {
  return requestBatchServer("/api/nightmare/status");
}

export function loadNightmareTeamStatus(teamId, { refresh = false } = {}) {
  const query = refresh ? "?refresh=1" : "";
  return requestBatchServer(
    `/api/nightmare/teams/${encodeURIComponent(teamId)}/status${query}`,
  );
}

export function prepareNightmareTeam(teamId) {
  return requestBatchServer(
    `/api/nightmare/teams/${encodeURIComponent(teamId)}/prepare`,
    { method: "POST", body: {} },
  );
}

export function disbandNightmareTeam(teamId) {
  return requestBatchServer(
    `/api/nightmare/teams/${encodeURIComponent(teamId)}/disband`,
    { method: "POST", body: {} },
  );
}

export function startNightmareTeam(teamId) {
  return requestBatchServer(
    `/api/nightmare/teams/${encodeURIComponent(teamId)}/start`,
    { method: "POST", body: {} },
  );
}

export function startNightmareCharmPurchase(tokenIds) {
  return requestBatchServer("/api/nightmare/charm-purchase", {
    method: "POST",
    body: { token_ids: tokenIds },
  });
}
