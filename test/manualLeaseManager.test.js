import assert from "node:assert/strict";
import test from "node:test";
import { ManualLeaseManager } from "../render-backend/lib/manualLeaseManager.js";
import { TokenLockQueue } from "../render-backend/lib/tokenLockQueue.js";

test("manual leases hold account locks and wake FIFO waiters on release", async () => {
  const lockQueue = new TokenLockQueue();
  const manager = new ManualLeaseManager({ lockQueue });
  const lease = await manager.acquire(["a", "b"], { ttlMs: 30_000 });
  assert.deepEqual(lease.token_ids, ["a", "b"]);
  assert.equal(lockQueue.isLocked("a"), true);
  assert.equal(lockQueue.isLocked("b"), true);

  let queued = false;
  const waiting = lockQueue.acquire("b", "scheduled-task", {
    onWait: () => {
      queued = true;
    },
  });
  await Promise.resolve();
  assert.equal(queued, true);

  assert.equal(manager.release(lease.id), true);
  await waiting;
  assert.equal(lockQueue.holder("b"), "scheduled-task");
  lockQueue.release("b", "scheduled-task");
});

test("heartbeat extends a lease and expiry releases it", async () => {
  const lockQueue = new TokenLockQueue();
  const manager = new ManualLeaseManager({ lockQueue });
  const lease = await manager.acquire(["a"], { ttlMs: 30_000 });
  const renewed = manager.heartbeat(lease.id, { ttlMs: 30_000 });
  assert.ok(new Date(renewed.expires_at).getTime() > Date.now());
  assert.equal(manager.list().length, 1);

  manager._scheduleExpiry(lease.id, 10);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(manager.list().length, 0);
  assert.equal(lockQueue.isLocked("a"), false);
});
