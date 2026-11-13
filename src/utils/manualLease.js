import {
  loadServerConnection,
  serverRequest,
} from "@/api/serverTasks";

const LEASE_TTL_MS = 90_000;
const HEARTBEAT_MS = 30_000;

let activeLease = null;
let heartbeatTimer = null;
let leaseOperation = Promise.resolve(null);

function request(path, options = {}) {
  return serverRequest(path, {
    ...loadServerConnection(),
    ...options,
  });
}

function sameTokens(left, right) {
  const a = [...new Set(left.map(String))].sort();
  const b = [...new Set(right.map(String))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

async function heartbeat() {
  if (!activeLease) return;
  try {
    const lease = await request(
      `/api/manual-leases/${encodeURIComponent(activeLease.id)}/heartbeat`,
      {
        method: "POST",
        body: { ttl_ms: LEASE_TTL_MS },
      },
    );
    activeLease = lease;
  } catch (error) {
    console.warn("手动执行租约续租失败:", error.message);
    stopHeartbeat();
    const lease = activeLease;
    if (/404/.test(String(error.message))) activeLease = null;
    window.dispatchEvent(
      new CustomEvent("xyzw:manual-lease-lost", {
        detail: { lease, error: error.message },
      }),
    );
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
}

export function getActiveManualLease() {
  return activeLease;
}

export async function releaseManualLease() {
  stopHeartbeat();
  const lease = activeLease;
  activeLease = null;
  if (!lease) return false;
  try {
    await request(`/api/manual-leases/${encodeURIComponent(lease.id)}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (!/404/.test(String(error.message))) {
      console.warn("释放手动执行租约失败:", error.message);
    }
  }
  return true;
}

async function acquireNow(tokenIds) {
  const ids = [...new Set(tokenIds.map(String).filter(Boolean))];
  if (ids.length === 0) return null;
  if (activeLease && sameTokens(activeLease.token_ids || [], ids)) {
    return activeLease;
  }
  await releaseManualLease();
  activeLease = await request("/api/manual-leases", {
    method: "POST",
    body: {
      token_ids: ids,
      ttl_ms: LEASE_TTL_MS,
      owner: "batch-daily-browser",
    },
  });
  startHeartbeat();
  return activeLease;
}

/**
 * Ensure the browser owns NAS account leases before opening game sessions.
 */
export function ensureManualLease(tokenIds) {
  const ids = [...new Set((tokenIds || []).map(String).filter(Boolean))];
  if (ids.length === 0) return Promise.resolve(null);
  if (activeLease && sameTokens(activeLease.token_ids || [], ids)) {
    return Promise.resolve(activeLease);
  }
  leaseOperation = leaseOperation.then(
    () => acquireNow(ids),
    () => acquireNow(ids),
  );
  return leaseOperation;
}

export function resetManualLeaseForTests() {
  stopHeartbeat();
  activeLease = null;
  leaseOperation = Promise.resolve(null);
}
