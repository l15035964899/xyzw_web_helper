import { randomUUID } from "node:crypto";

const DEFAULT_TTL_MS = 90_000;
const MIN_TTL_MS = 30_000;
const MAX_TTL_MS = 300_000;

function boundedTtl(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.trunc(parsed)));
}

/**
 * Hold FIFO account locks for browser-side manual task execution.
 * Heartbeats extend each lease; an expired lease releases its accounts.
 */
export class ManualLeaseManager {
  constructor({ lockQueue, defaultTtlMs = DEFAULT_TTL_MS } = {}) {
    if (!lockQueue) throw new Error("ManualLeaseManager requires lockQueue");
    this.lockQueue = lockQueue;
    this.defaultTtlMs = boundedTtl(defaultTtlMs);
    this.leases = new Map();
    this.leaseTimers = new Map();
  }

  async acquire(
    tokenIds,
    { ttlMs = this.defaultTtlMs, onWait, owner = "browser" } = {},
  ) {
    const ids = [...new Set((tokenIds || []).map(String).filter(Boolean))];
    if (ids.length === 0) throw new Error("至少选择一个账号");

    const leaseId = randomUUID();
    const holderId = `manual:${leaseId}`;
    const lease = await this.lockQueue.acquireAll(ids, holderId, { onWait });
    const record = {
      id: leaseId,
      holderId,
      tokenIds: ids,
      owner: String(owner || "browser"),
      lease,
      expiresAt: 0,
    };
    this.leases.set(leaseId, record);
    this._scheduleExpiry(leaseId, boundedTtl(ttlMs));
    return this.publicLease(record);
  }

  heartbeat(leaseId, { ttlMs = this.defaultTtlMs } = {}) {
    const record = this.leases.get(String(leaseId));
    if (!record) return null;
    this._scheduleExpiry(record.id, boundedTtl(ttlMs));
    return this.publicLease(record);
  }

  release(leaseId) {
    const id = String(leaseId);
    const record = this.leases.get(id);
    if (!record) return false;
    const timer = this.leaseTimers.get(id);
    if (timer) clearTimeout(timer);
    this.leaseTimers.delete(id);
    this.leases.delete(id);
    record.lease.release();
    return true;
  }

  releaseAll() {
    for (const id of [...this.leases.keys()]) this.release(id);
  }

  list() {
    return [...this.leases.values()]
      .map((record) => this.publicLease(record))
      .sort((left, right) => left.expires_at.localeCompare(right.expires_at));
  }

  publicLease(record) {
    return {
      id: record.id,
      token_ids: [...record.tokenIds],
      owner: record.owner,
      expires_at: new Date(record.expiresAt).toISOString(),
    };
  }

  _scheduleExpiry(leaseId, ttlMs) {
    const previous = this.leaseTimers.get(leaseId);
    if (previous) clearTimeout(previous);
    const record = this.leases.get(leaseId);
    if (!record) return;
    record.expiresAt = Date.now() + ttlMs;
    const timer = setTimeout(() => {
      if (!this.leases.has(leaseId)) return;
      this.release(leaseId);
    }, ttlMs);
    timer.unref?.();
    this.leaseTimers.set(leaseId, timer);
  }
}
