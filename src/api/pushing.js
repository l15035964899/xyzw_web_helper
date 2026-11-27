import { loadServerConnection, serverRequest } from "@/api/serverTasks";

function requestPushing(path, options = {}) {
  return serverRequest(path, {
    ...loadServerConnection(),
    ...options,
  });
}

export function loadPushingStatus(request = requestPushing) {
  return request("/api/pushing/status");
}

export function loadPushingRun(runId, request = requestPushing) {
  return request(`/api/pushing/runs/${encodeURIComponent(runId)}`);
}

export function startPushingRun(
  { tokenIds, options },
  request = requestPushing,
) {
  return request("/api/pushing/runs", {
    method: "POST",
    body: { token_ids: tokenIds, options },
  });
}

export function stopPushingRun(
  runId,
  { reason = "用户手动停止" } = {},
  request = requestPushing,
) {
  return request(`/api/pushing/runs/${encodeURIComponent(runId)}/stop`, {
    method: "POST",
    body: { reason },
  });
}

export function usePushingTorch(
  runId,
  { tokenIds, itemId, quantity },
  request = requestPushing,
) {
  return request(`/api/pushing/runs/${encodeURIComponent(runId)}/use-torch`, {
    method: "POST",
    body: {
      token_ids: tokenIds,
      item_id: itemId,
      quantity,
    },
  });
}

export function loadPushingLogs(
  runId,
  { limit = 200 } = {},
  request = requestPushing,
) {
  const query = new URLSearchParams({
    run_id: String(runId),
    limit: String(limit),
  });
  return request(`/api/logs/db?${query.toString()}`);
}
